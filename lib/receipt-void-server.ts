import 'server-only';
import { createProtectedDataClient } from './protected-data-server';

// A single database snapshot covers balances, credits and treatment-plan links.
export async function prepareReceiptVoid(targetId: string) {
  const { data, error } = await createProtectedDataClient().rpc('prepare_pos_void', { p_target_id: targetId });
  if (error) throw new Error(error.message || 'Could not verify the original financial records.');
  return data;
}
