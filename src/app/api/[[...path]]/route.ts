/* FirstLight — operational API catch-all route.
 *
 * One serverless surface dispatching every /api/* request through the
 * validated, request-ID'd, rate-limited router (src/server/api/router.ts).
 * Demo/static builds never execute this file (static export has no server;
 * scripts/build-static.sh excludes it from static builds entirely).
 */

import { dispatch } from '@/server/api/router';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  return dispatch(req);
}

export async function POST(req: Request): Promise<Response> {
  return dispatch(req);
}

export async function PATCH(req: Request): Promise<Response> {
  return dispatch(req);
}

export async function PUT(req: Request): Promise<Response> {
  return dispatch(req);
}

export async function DELETE(req: Request): Promise<Response> {
  return dispatch(req);
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      allow: 'GET, POST, PATCH, OPTIONS',
      'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
    },
  });
}
