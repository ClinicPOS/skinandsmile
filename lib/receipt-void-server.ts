import 'server-only';
import { createProtectedDataClient } from './protected-data-server';

// A single database snapshot covers balances, credits and treatment-plan links.
export async function prepareReceiptVoid(targetId: string, keepPlanId?: string) {
  const { data, error } = await createProtectedDataClient().rpc(keepPlanId ? 'prepare_duplicate_plan_void' : 'prepare_pos_void', keepPlanId ? {p_payment_id:targetId,p_keep_id:keepPlanId} : { p_target_id: targetId });
  if (error) throw new Error(error.message || 'Could not verify the original financial records.');
  return data;
}
