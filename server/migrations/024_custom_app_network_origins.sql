ALTER TABLE custom_app_capability_manifests
  ADD COLUMN allowed_network_origins_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE custom_app_capability_requests
  ADD COLUMN requested_network_origins_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE custom_app_capability_requests
  ADD COLUMN missing_network_origins_json TEXT NOT NULL DEFAULT '[]';

