START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 113, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.datasets_;

CREATE TYPE webknossos.LENGTH_UNIT AS ENUM ('ym', 'zm', 'am', 'fm', 'pm', 'nm', 'µm', 'mm', 'cm', 'dm', 'm', 'hm', 'km', 'Mm', 'Gm', 'Tm', 'Pm', 'Em', 'Zm', 'Ym', 'Å', 'in', 'ft', 'yd', 'mi', 'pc');

ALTER TABLE webknossos.datasets RENAME COLUMN scale TO voxelSizeFactor;
ALTER TABLE webknossos.datasets ADD COLUMN voxelSizeUnit webknossos.LENGTH_UNIT;

CREATE VIEW webknossos.datasets_ AS SELECT * FROM webknossos.datasets WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 114;

COMMIT TRANSACTION;
