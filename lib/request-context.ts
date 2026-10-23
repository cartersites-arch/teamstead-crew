import { AsyncLocalStorage } from 'node:async_hooks';

// Each concurrent request gets its own headers. There is no shared current user.
const requests = new AsyncLocalStorage<Request>();

export function withRequest<T>(request: Request, callback: () => T): T {
  return requests.run(request, callback);
}

export async function headers(): Promise<Headers> {
  const request = requests.getStore();
  if (!request) throw new Error('A request context is required.');
  return request.headers;
}

export function request(){return requests.getStore();}
