-- Run ONLY in the separate pos_restore_audit_20261008 database.
DO $check$
DECLARE constraint_row record; conditions text; nonnull_conditions text; orphan_count bigint; checked integer:=0;
BEGIN
 FOR constraint_row IN
 SELECT c.oid,c.conrelid,c.confrelid,c.conkey,c.confkey FROM pg_constraint c
 JOIN pg_namespace n ON n.oid=(SELECT relnamespace FROM pg_class WHERE oid=c.conrelid)
 WHERE c.contype='f' AND n.nspname IN ('public','auth','storage')
 LOOP
  SELECT string_agg(format('p.%I = r.%I',parent.attname,child.attname),' AND ' ORDER BY keys.position),
         string_agg(format('r.%I IS NOT NULL',child.attname),' AND ' ORDER BY keys.position)
  INTO conditions,nonnull_conditions
  FROM unnest(constraint_row.conkey,constraint_row.confkey) WITH ORDINALITY AS keys(child_number,parent_number,position)
  JOIN pg_attribute child ON child.attrelid=constraint_row.conrelid AND child.attnum=keys.child_number
  JOIN pg_attribute parent ON parent.attrelid=constraint_row.confrelid AND parent.attnum=keys.parent_number;
  EXECUTE format('SELECT count(*) FROM %s r WHERE %s AND NOT EXISTS (SELECT 1 FROM %s p WHERE %s)',constraint_row.conrelid::regclass,nonnull_conditions,constraint_row.confrelid::regclass,conditions) INTO orphan_count;
  IF orphan_count<>0 THEN RAISE EXCEPTION 'Restored record relationship failed: constraint %, orphan count %',constraint_row.oid,orphan_count; END IF;
  checked:=checked+1;
 END LOOP;
 RAISE NOTICE 'PASS: % restored foreign-key relationships checked',checked;
END;
$check$;
