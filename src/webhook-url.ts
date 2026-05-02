export const DEFAULT_WEBHOOK_LABEL = "runtime-events";
export const DEFAULT_WEBHOOK_PATH = "/webhooks/multibaas";
export const DEFAULT_WEBHOOK_PORT = 8787;

function normalizeRequestPath(requestPath: string): string {
  return requestPath.startsWith("/") ? requestPath : `/${requestPath}`;
}

export function deriveDefaultWebhookUrl(
  multibaasBaseUrl: string,
  options: {
    port?: number;
    requestPath?: string;
    publicBaseUrl?: string;
  } = {},
): string | undefined {
  const requestPath = normalizeRequestPath(options.requestPath ?? DEFAULT_WEBHOOK_PATH);
  const port = options.port ?? DEFAULT_WEBHOOK_PORT;
  const publicBaseUrl = options.publicBaseUrl ?? process.env.MULTIBAAS_WEBHOOK_PUBLIC_URL;

  if (publicBaseUrl) {
    return new URL(requestPath, publicBaseUrl.endsWith("/") ? publicBaseUrl : `${publicBaseUrl}/`).toString();
  }

  const url = new URL(multibaasBaseUrl);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    return `http://127.0.0.1:${port}${requestPath}`;
  }

  return undefined;
}
