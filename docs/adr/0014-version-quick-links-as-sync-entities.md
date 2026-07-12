# Version Quick Links as Sync Entities

Version two will represent each Quick Link as an independently versioned Sync Entity with synchronized position and a Deletion Marker, so add, edit, remove, and reorder operations converge under the same rules as Saved Tabs instead of resurrecting stale links. Uploaded image icons remain Device-local State: changing only that image does not schedule synchronization, remote field changes preserve the local image override, and a winning remote deletion removes the visible link and its cached local icon.
