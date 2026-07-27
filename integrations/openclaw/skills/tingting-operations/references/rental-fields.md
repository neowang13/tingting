# Rental fields and resolution

Resolve in this order: owner-supplied UUID; exact source system plus external
reference; exact slug; unique address/title search; otherwise ask the owner to
choose.

Never update from a fuzzy address match. Required draft fields are slug, title,
address, city, positive monthly rent cents, bedrooms, bathrooms, description,
sort order, and an images array. Optional facts remain null. Marketing copy may
use supplied facts only and must not invent amenities, safety, schools,
protected-characteristic claims, or distances.

Publication requires 1–20 validated images, exactly one cover, valid alt text,
and a version-bound confirmation. Published records must be confirmed as
unpublished before editing.

