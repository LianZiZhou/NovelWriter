// Runs the NovelWriter server inside the Electron main process.
import { randomBytes } from 'node:crypto';
import { createServer, type AddressInfo } from 'node:net';
// pi-ai loads its OAuth flows and the Bedrock client through variable import
// specifiers so bundlers skip them. In a single-file bundle those relative
// paths do not exist, so register statically imported copies instead (the
// same hooks pi-ai's standalone Bun binary uses).
import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth';
import { bedrockProviderModule } from '@earendil-works/pi-ai/bedrock-provider';
import { setBedrockProviderModule } from '@earendil-works/pi-ai/api/bedrock-converse-stream.lazy';
import { buildApp } from '../../server/src/app.ts';

registerBunOAuthFlows();
setBedrockProviderModule(bedrockProviderModule);

export interface RunningServer {
  /** e.g. http://127.0.0.1:51234 */
  origin: string;
  port: number;
  /** `Authorization` header value every request to the server must carry. */
  authorization: string;
  close(): Promise<void>;
}

export interface StartOptions {
  dataDir: string;
  staticDir: string;
  /** Port to try first (the one used last time, so the page origin and its localStorage stay the same). */
  preferredPort?: number;
  logger?: boolean;
}

export async function startServer(opts: StartOptions): Promise<RunningServer> {
  // A fresh password per launch: other local programs and web pages in the
  // user's browser cannot use the API (and the stored credentials) without it.
  const password = randomBytes(24).toString('base64url');
  const app = await buildApp({ dataDir: opts.dataDir, staticDir: opts.staticDir, logger: opts.logger ?? false, password });
  const host = '127.0.0.1';
  const port = (opts.preferredPort && (await portIsFree(host, opts.preferredPort))) ? opts.preferredPort : 0;
  await app.listen({ host, port });
  const actual = (app.server.address() as AddressInfo).port;
  return {
    origin: `http://${host}:${actual}`,
    port: actual,
    authorization: `Basic ${Buffer.from(`novelwriter:${password}`).toString('base64')}`,
    close: () => app.close(),
  };
}

function portIsFree(host: string, port: number): Promise<boolean> {
  if (!Number.isInteger(port) || port <= 1024 || port >= 65536) return Promise.resolve(false);
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen({ host, port, exclusive: true }, () => probe.close(() => resolve(true)));
  });
}
