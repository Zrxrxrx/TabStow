# Synchronize Saved Order per entity

Tabstow will synchronize the Saved Order of Tab Sessions and Saved Tabs using an independently versioned position on each entity, so moving one item does not replace the entire list. Concurrent moves of different entities can both survive, competing moves of the same entity follow the established logical-revision rule, and equal positions are ordered deterministically by entity ID.
