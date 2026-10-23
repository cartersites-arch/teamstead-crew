DROP TRIGGER r2_objects_quota;
DROP TRIGGER r2_manual_quota;
CREATE TRIGGER r2_objects_quota BEFORE INSERT ON r2_objects WHEN NOT EXISTS(SELECT 1 FROM r2_objects WHERE app=NEW.app AND object_key=NEW.object_key) AND (SELECT COALESCE(SUM(size),0) FROM r2_objects)+(SELECT COALESCE(SUM(size),0) FROM r2_manual_objects)+NEW.size>500000000 BEGIN SELECT RAISE(ABORT,'R2_BUDGET_FULL'); END;
CREATE TRIGGER r2_manual_quota BEFORE INSERT ON r2_manual_objects WHEN NOT EXISTS(SELECT 1 FROM r2_manual_objects WHERE app=NEW.app AND object_key=NEW.object_key) AND (SELECT COALESCE(SUM(size),0) FROM r2_objects)+(SELECT COALESCE(SUM(size),0) FROM r2_manual_objects)+NEW.size>500000000 BEGIN SELECT RAISE(ABORT,'R2_BUDGET_FULL'); END;
