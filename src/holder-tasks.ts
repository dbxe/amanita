import { loadState, saveState, type LocalState } from "./state.js";
import {
  createHolderQueryTask,
  findHolderQueryTask,
  transitionTask,
  upsertTask,
  type HolderQueryTaskRecord,
} from "./tasks.js";

export interface HolderRequestInput {
  contractAddress?: string;
  limit: number;
  needsInterfaceClarification?: boolean;
  rawText: string;
  tokenName?: string;
}

export interface HolderTaskDeps {
  ensureReady: (contractAddress: string) => Promise<{
    addressAlias?: string;
    contractAddress: string;
    contractLabel?: string;
    contractVersion?: string;
    state: HolderQueryTaskRecord["state"];
    waitCondition?: HolderQueryTaskRecord["waitCondition"];
  }>;
  executeHolderQuery: (task: HolderQueryTaskRecord) => Promise<string>;
  resolveTokenName?: (tokenName: string) => Promise<{ address: string; alias?: string } | undefined>;
}

export interface HolderRequestResult {
  responseText: string;
  task?: HolderQueryTaskRecord;
}

export interface HolderEvaluationResult {
  messages: string[];
  state: LocalState;
}

function formatInterfaceClarification(address: string): string {
  return `I can compute top ERC-20 holders for ${address}, but first confirm that I should treat it as an ERC-20 token contract.`;
}

function formatMissingAddressPrompt(tokenName: string): string {
  return `I don't know the contract address for ${tokenName} yet. Tell me the token contract address and I'll check whether MultiBaas has already linked and indexed it.`;
}

function formatWaitingResponse(task: HolderQueryTaskRecord): string {
  const reason = task.waitCondition?.reason ?? `Task ${task.id} is waiting in state ${task.state}.`;
  return `I’ll follow up once it has synced.\n${reason}`;
}

function createOrReuseTask(state: LocalState, input: Required<Pick<HolderRequestInput, "contractAddress" | "limit" | "rawText">>, queryName: string) {
  const existingTask = findHolderQueryTask(state.tasks, input.contractAddress, input.limit, queryName);
  return {
    task:
      existingTask ??
      createHolderQueryTask({
        contractAddress: input.contractAddress,
        intent: input.rawText,
        limit: input.limit,
        queryName,
      }),
  };
}

function taskWithOnboarding(task: HolderQueryTaskRecord, now: string, onboarding: Awaited<ReturnType<HolderTaskDeps["ensureReady"]>>) {
  return transitionTask(task, onboarding.state, now, {
    addressAlias: onboarding.addressAlias,
    contractLabel: onboarding.contractLabel,
    contractVersion: onboarding.contractVersion,
    lastEvaluatedAt: now,
    waitCondition: onboarding.waitCondition,
  }) as HolderQueryTaskRecord;
}

export async function requestTopHolders(
  stateDir: string,
  input: HolderRequestInput,
  deps: HolderTaskDeps,
  queryName: string,
): Promise<HolderRequestResult> {
  if (input.needsInterfaceClarification && input.contractAddress) {
    return { responseText: formatInterfaceClarification(input.contractAddress) };
  }

  let contractAddress = input.contractAddress;
  if (!contractAddress && input.tokenName) {
    const resolved = await deps.resolveTokenName?.(input.tokenName);
    if (!resolved) {
      return { responseText: formatMissingAddressPrompt(input.tokenName) };
    }
    contractAddress = resolved.address;
  }

  if (!contractAddress) {
    return { responseText: "Tell me the token contract address and I'll check whether MultiBaas has already linked and indexed it." };
  }

  const state = loadState(stateDir);
  const now = new Date().toISOString();
  const { task } = createOrReuseTask(
    state,
    {
      contractAddress,
      limit: input.limit,
      rawText: input.rawText,
    },
    queryName,
  );
  const onboarding = await deps.ensureReady(contractAddress);
  const updatedTask = taskWithOnboarding(task, now, onboarding);

  if (updatedTask.state !== "ready") {
    const nextState: LocalState = {
      ...state,
      tasks: upsertTask(state.tasks, updatedTask),
    };
    saveState(stateDir, nextState);
    return {
      responseText: formatWaitingResponse(updatedTask),
      task: updatedTask,
    };
  }

  const resultText = await deps.executeHolderQuery(updatedTask);
  const answeredTask = transitionTask(updatedTask, "ready", now, {
    lastReportedAt: now,
    resultText,
  }) as HolderQueryTaskRecord;
  const nextState: LocalState = {
    ...state,
    tasks: upsertTask(state.tasks, answeredTask),
  };
  saveState(stateDir, nextState);
  return { responseText: resultText, task: answeredTask };
}

export async function evaluatePendingHolderQueries(
  stateDir: string,
  deps: Omit<HolderTaskDeps, "resolveTokenName">,
  queryName: string,
): Promise<HolderEvaluationResult> {
  const state = loadState(stateDir);
  let nextState: LocalState = { ...state, tasks: [...state.tasks] };
  const messages: string[] = [];

  for (const task of state.tasks) {
    if (task.kind !== "holder-query") {
      continue;
    }
    if (task.state === "ready" && task.resultText && task.lastReportedAt) {
      continue;
    }

    const now = new Date().toISOString();
    if (task.state === "ready" && task.resultText && !task.lastReportedAt) {
      messages.push(task.resultText);
      nextState = {
        ...nextState,
        tasks: upsertTask(
          nextState.tasks,
          transitionTask(task, "ready", now, {
            lastReportedAt: now,
          }) as HolderQueryTaskRecord,
        ),
      };
      continue;
    }

    const contractAddress = task.viewSpec.contractAddress;
    if (!contractAddress) {
      continue;
    }

    const onboarding = await deps.ensureReady(contractAddress);
    const updatedTask = taskWithOnboarding(task, now, onboarding);
    if (updatedTask.state !== "ready") {
      nextState = {
        ...nextState,
        tasks: upsertTask(nextState.tasks, updatedTask),
      };
      continue;
    }

    const resultText = await deps.executeHolderQuery(updatedTask);
    messages.push(resultText);
    nextState = {
      ...nextState,
      tasks: upsertTask(
        nextState.tasks,
        transitionTask(updatedTask, "ready", now, {
          lastReportedAt: now,
          resultText,
        }) as HolderQueryTaskRecord,
      ),
    };
  }

  saveState(stateDir, nextState);
  return { messages, state: nextState };
}
