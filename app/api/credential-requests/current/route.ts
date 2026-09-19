import { getCollectionHandler } from '@/lib/runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET(request: Request) {
  return getCollectionHandler()(request);
}

export function PATCH(request: Request) {
  return getCollectionHandler()(request);
}
