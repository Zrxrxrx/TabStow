# Migrate version-one data once and write only version two

The new extension will read an existing version-one Sync File once, convert its Saved for Later and Quick Links into the version-two entity model, and write only `schemaVersion: 2` after authorization, validation, and any required Connection Confirmation. It will not dual-write or support continued synchronization by old clients; old versions must reject version two rather than risk erasing revisions and Deletion Markers.
