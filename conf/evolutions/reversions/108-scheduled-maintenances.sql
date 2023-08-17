START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 108, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP TABLE webknossos.maintenances;


CREATE TABLE webknossos.maintenance(
  maintenanceExpirationTime TIMESTAMPTZ NOT NULL
);
INSERT INTO webknossos.maintenance(maintenanceExpirationTime) values('2000-01-01 00:00:00');


UPDATE webknossos.releaseInformation SET schemaVersion = 107;

COMMIT TRANSACTION;
