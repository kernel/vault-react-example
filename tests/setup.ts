import { GlobalRegistrator } from '@happy-dom/global-registrator';

const http = { Request, Response, Headers, fetch, AbortController, AbortSignal };
GlobalRegistrator.register({ url: 'https://app.example.com' });
// Keep server HTTP semantics; Happy DOM strips the Origin header as a browser would.
Object.assign(globalThis, http);
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
