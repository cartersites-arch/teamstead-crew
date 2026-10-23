// Immutable target identity: this worker must never serve the PMS database.
export const TEAMSTEAD_DATABASE_ID = '24543c2f-3d1f-4313-b46f-0708b6db28a1';
export const TEAMSTEAD_HOST = 'teamstead-crew.pages.dev';
export async function teamsteadBoundary(request: Request, database?: D1Database): Promise<boolean> {
  if (!database || new URL(request.url).hostname !== TEAMSTEAD_HOST) return false;
  try {
    const identity = await database.prepare('SELECT product, database_id, active FROM product_identity WHERE id=1').first<{product:string;database_id:string;active:number}>();
    return identity?.product === 'teamstead-sales' && identity.database_id === TEAMSTEAD_DATABASE_ID && identity.active === 1;
  } catch { return false; }
}
