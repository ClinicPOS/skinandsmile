import type { SupabaseClient } from '@supabase/supabase-js';

export function historyDateRange(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Choose a valid date.');
  const midnight = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== day) throw new Error('Choose a valid date.');
  return {start: `${day}T00:00:00+04:00`, end: `${new Date(midnight.getTime() + 86400000).toISOString().slice(0, 10)}T00:00:00+04:00`};
}

// Only IDs from an authorized clinic's bounded page can reach the patient lookup.
export async function readModalReceiptHistory(db: SupabaseClient, clinicId: string, kind: 'receipt' | 'plan', offset: number, day: string | null) {
  let query = db.from(kind === 'receipt' ? 'receipts' : 'treatment_plan_payment_records').select('*');
  if (kind === 'receipt') {
    const staffIds: string[] = [];
    for (let from = 0; ; from += 500) {
      const result = await db.from('receptionist').select('id').eq('clinic_id', clinicId).order('id').range(from, from + 499);
      if (result.error) throw result.error;
      staffIds.push(...(result.data || []).map(row => row.id));
      if ((result.data || []).length < 500) break;
    }
    query = query.or(`clinic_id.eq.${clinicId}${staffIds.length ? `,and(clinic_id.is.null,receptionist_id.in.(${staffIds.join(',')}))` : ''}`);
  } else query = query.eq('clinic_id', clinicId);
  if (day) {
    const {start, end} = historyDateRange(day);
    query = query.gte('created_at', start).lt('created_at', end);
  }
  const result = await query.order('created_at', {ascending: false}).order('id', {ascending: false}).range(offset, offset + 50);
  if (result.error) throw result.error;
  const rows = (result.data || []).slice(0, 50);
  const ids = [...new Set<string>(rows.map(row => row.patient_id).filter(Boolean))];
  const empty = {data: [], error: null};
  const [patients, files] = await Promise.all(ids.length ? [
    db.from('patients').select('id,name,phone,patient_number').in('id', ids),
    db.from('clinic_patient_files').select('patient_id,file_no').eq('clinic_id', clinicId).in('patient_id', ids),
  ] : [empty, empty]);
  if (patients.error || files.error) throw patients.error || files.error;
  const fileNumbers = new Map((files.data || []).map(row => [row.patient_id, row.file_no]));
  return {receipts: kind === 'receipt' ? rows : [], planPayments: kind === 'plan' ? rows : [],
    patients: (patients.data || []).map(row => ({...row, clinic_file_no: fileNumbers.get(row.id) || null})), hasMore: (result.data || []).length > 50};
}
