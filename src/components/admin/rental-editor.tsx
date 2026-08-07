"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useRef, useState } from "react";
import { MediaLibrary } from "@/components/admin/media-library";
import {
  amenityGroups,
  rentalToV2,
  utilityOptions,
  type RentalListingV2Input
} from "@/features/rentals/v2";
import { rentalListingV2InputSchema } from "@/lib/schemas";
import type { MediaAsset, RentalFee, RentalListing } from "@/lib/contracts";

type FeeRow = RentalFee & { key: string };

export function RentalEditor({
  rental,
  initialMedia
}: {
  rental: RentalListing | null;
  initialMedia: MediaAsset[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const initial = useMemo(() => rental ? rentalToV2(rental) : emptyRental(), [rental]);
  const [current, setCurrent] = useState(rental);
  const [slug, setSlug] = useState(rental?.slug ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [media, setMedia] = useState(initialMedia);
  const [availability, setAvailability] = useState(initial.availability.status ?? "");
  const [leaseType, setLeaseType] = useState(initial.availability.leaseType ?? "");
  const [parkingAvailable, setParkingAvailable] = useState(initial.parking.available);
  const [storageAvailable, setStorageAvailable] = useState(initial.storage.available);
  const [petStatus, setPetStatus] = useState(initial.pets.status ?? "");
  const [customContact, setCustomContact] = useState(initial.contact.mode === "custom");
  const [fees, setFees] = useState<FeeRow[]>(initial.fees.map((fee, index) => ({
    ...fee,
    key: fee.id ?? `existing-${index}`
  })));
  const [selectedImages, setSelectedImages] = useState(
    rental ? [...rental.images].sort((a, b) => a.sortOrder - b.sortOrder).map((image) => image.mediaAssetId) : []
  );
  const [coverMediaAssetId, setCoverMediaAssetId] = useState(
    rental?.images.find((image) => image.isCover)?.mediaAssetId ?? ""
  );
  const selectedMedia = selectedImages.flatMap((id) => {
    const asset = media.find((item) => item.id === id);
    return asset ? [asset] : [];
  });
  const liveHasChanges = Boolean(
    current?.status === "published" &&
    current.draftDigest &&
    current.publishedSourceDigest &&
    current.draftDigest !== current.publishedSourceDigest
  );

  function updateMedia(nextMedia: MediaAsset[]) {
    const previousIds = new Set(media.map((asset) => asset.id));
    const nextIds = new Set(nextMedia.map((asset) => asset.id));
    const addedIds = nextMedia.filter((asset) => !previousIds.has(asset.id)).map((asset) => asset.id);
    setMedia(nextMedia);
    setSelectedImages((items) => {
      const kept = items.filter((id) => nextIds.has(id));
      return [...kept, ...addedIds.filter((id) => !kept.includes(id))].slice(0, 20);
    });
    setCoverMediaAssetId((id) => id && nextIds.has(id) ? id : "");
  }

  function formPayload(formElement: HTMLFormElement): RentalListingV2Input {
    const form = new FormData(formElement);
    const numberOrNull = (name: string) => form.get(name) === "" || form.get(name) === null
      ? null
      : Number(form.get(name));
    const checked = (name: string) => form.get(name) === "on";
    const valueOrNull = (name: string) => String(form.get(name) ?? "").trim() || null;
    const parking = checked("parkingAvailable");
    const storage = checked("storageAvailable");
    const pets = String(form.get("petStatus") ?? "") || null;
    const contactMode = checked("useSiteContact") ? "site_default" as const : "custom" as const;
    return {
      slug: normalizeRentalSlug(String(form.get("slug"))),
      title: String(form.get("title")),
      property: {
        id: current?.property?.id ?? null,
        expectedVersion: current?.property?.updatedAt ?? null,
        propertyType: String(form.get("propertyType")) as RentalListingV2Input["property"]["propertyType"],
        buildingName: valueOrNull("buildingName"),
        unitNumber: valueOrNull("unitNumber"),
        streetAddress: String(form.get("streetAddress")),
        neighbourhood: valueOrNull("neighbourhood"),
        city: String(form.get("city")),
        provinceCode: valueOrNull("provinceCode"),
        postalCode: valueOrNull("postalCode"),
        countryCode: "CA"
      },
      pricing: {
        monthlyRentCents: Math.round(Number(form.get("monthlyRent")) * 100),
        currencyCode: "CAD"
      },
      layout: {
        bedrooms: Number(form.get("bedrooms")),
        bathrooms: Number(form.get("bathrooms")),
        denCount: Number(form.get("denCount") || 0),
        squareFeet: numberOrNull("squareFeet"),
        furnishedStatus: (valueOrNull("furnishedStatus") ?? null) as RentalListingV2Input["layout"]["furnishedStatus"]
      },
      availability: {
        status: (valueOrNull("availabilityStatus") ?? null) as RentalListingV2Input["availability"]["status"],
        availableOn: availability === "available_on" ? valueOrNull("availableOn") : null,
        leaseType: (valueOrNull("leaseType") ?? null) as RentalListingV2Input["availability"]["leaseType"],
        minimumLeaseMonths: leaseType === "fixed_term" ? numberOrNull("minimumLeaseMonths") : null
      },
      parking: {
        available: parking,
        type: parking ? valueOrNull("parkingType") as RentalListingV2Input["parking"]["type"] : null,
        stalls: parking ? numberOrNull("parkingStalls") : null,
        included: parking ? checked("parkingIncluded") : null,
        visitorAvailable: checked("visitorParkingAvailable"),
        notes: valueOrNull("parkingNotes")
      },
      storage: {
        available: storage,
        lockers: storage ? numberOrNull("storageLockers") : null,
        included: storage ? checked("storageIncluded") : null,
        notes: valueOrNull("storageNotes")
      },
      pets: {
        status: pets as RentalListingV2Input["pets"]["status"],
        catsAllowed: pets !== "not_allowed" && checked("catsAllowed"),
        dogsAllowed: pets !== "not_allowed" && checked("dogsAllowed"),
        maxCount: pets && pets !== "not_allowed" ? numberOrNull("petMaxCount") : null,
        sizeLimitLbs: pets && pets !== "not_allowed" ? numberOrNull("petSizeLimitLbs") : null,
        notes: valueOrNull("petNotes")
      },
      smokingPolicy: (valueOrNull("smokingPolicy") ?? null) as RentalListingV2Input["smokingPolicy"],
      applicationRequirements: {
        creditCheckRequired: checked("creditCheckRequired"),
        referencesRequired: checked("referencesRequired")
      },
      amenityCodes: form.getAll("amenityCodes").map(String),
      includedUtilityCodes: form.getAll("includedUtilityCodes").map(String),
      fees: fees.map((fee, index) => ({
        ...(fee.id ? { id: fee.id } : {}),
        feeType: String(form.get(`feeType-${fee.key}`)) as RentalFee["feeType"],
        label: valueOrNull(`feeLabel-${fee.key}`),
        amountCents: Math.round(Number(form.get(`feeAmount-${fee.key}`)) * 100),
        frequency: String(form.get(`feeFrequency-${fee.key}`)) as RentalFee["frequency"],
        refundable: checked(`feeRefundable-${fee.key}`),
        required: checked(`feeRequired-${fee.key}`),
        notes: valueOrNull(`feeNotes-${fee.key}`),
        sortOrder: index
      })),
      contact: {
        mode: contactMode,
        name: contactMode === "custom" ? valueOrNull("contactName") : null,
        email: contactMode === "custom" ? valueOrNull("contactEmail") : null,
        phone: contactMode === "custom" ? valueOrNull("contactPhone") : null
      },
      utilitiesNotes: valueOrNull("utilitiesNotes"),
      amenityNotes: valueOrNull("amenityNotes"),
      description: String(form.get("description")),
      images: selectedImages.map((mediaAssetId, index) => ({
        mediaAssetId,
        sortOrder: index,
        isCover: mediaAssetId === coverMediaAssetId
      }))
    };
  }

  async function saveForm(formElement: HTMLFormElement) {
    const payload = formPayload(formElement);
    const parsed = rentalListingV2InputSchema.safeParse(payload);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new Error(first?.message ?? "Check the listing fields and try again.");
    }
    const response = await fetch(current ? `/api/admin/rentals/${current.id}` : "/api/admin/rentals", {
      method: current ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(current ? { rental: parsed.data, expectedVersion: current.updatedAt } : parsed.data)
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(rentalSaveError(result));
    setCurrent(result.data);
    return result.data as RentalListing;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("Saving…");
    try {
      const saved = await saveForm(event.currentTarget);
      setMessage("Saved privately. The public website has not changed.");
      if (!current) router.replace(`/admin/rentals/${saved.id}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Rental could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function publishCurrentForm() {
    const formElement = formRef.current;
    if (!current || !formElement) return;
    if (!formElement.reportValidity()) {
      setMessage("Complete the required listing fields before publishing.");
      return;
    }
    if (!window.confirm("Publish this saved version to the public website?")) return;
    setBusy(true);
    setMessage("Saving the current changes and publishing…");
    try {
      const saved = await saveForm(formElement);
      const response = await fetch(`/api/admin/rentals/${saved.id}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: saved.updatedAt })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(rentalSaveError(result));
      setCurrent(result.data);
      setMessage("Published. This rental is now live on the website.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The rental could not be published.");
    } finally {
      setBusy(false);
    }
  }

  async function statusAction(action: "unpublish" | "archive") {
    if (!current || !window.confirm(`Are you sure you want to ${action} this rental?`)) return;
    setBusy(true);
    setMessage("Updating status…");
    try {
      const response = await fetch(`/api/admin/rentals/${current.id}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: current.updatedAt })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error?.message ?? "Status could not be updated.");
      setCurrent(result.data);
      setMessage(result.data.status === "draft"
        ? "Removed from the public website. The listing remains saved privately."
        : "Listing archived and removed from the public website.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Status could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="prototype-page rental-editor-page">
      <div className="prototype-breadcrumb">
        <Link href="/admin/rentals">Rental listings</Link> / {current?.title ?? "New rental"}
      </div>
      <header className="rental-editor-header">
        <div>
          <p className="eyebrow">Rental listing</p>
          <h1>{current?.title ?? "Create a rental"}</h1>
        </div>
        <strong className="listing-state">{statusLabel(current, liveHasChanges)}</strong>
      </header>
      <form className="admin-form rental-v2-form" ref={formRef} onSubmit={submit}>
        <FormCard number={1} title="Home and address">
          <div className="field-grid">
            <label className="field"><span>Listing title</span><input name="title" required defaultValue={initial.title}
              onChange={(event) => { if (!current?.publishedAt) setSlug(normalizeRentalSlug(event.currentTarget.value)); }}
            /></label>
            <label className="field"><span>Property type</span><select name="propertyType" required defaultValue={initial.property.propertyType}>
              <option value="">Select type</option><option value="apartment">Apartment</option><option value="condo">Condo</option>
              <option value="townhome">Townhome</option><option value="house">House</option>
              <option value="basement_suite">Basement suite</option><option value="room">Room</option><option value="other">Other</option>
            </select></label>
            <label className="field"><span>Building name</span><input name="buildingName" defaultValue={initial.property.buildingName ?? ""} /></label>
            <label className="field"><span>Unit number</span><input name="unitNumber" defaultValue={initial.property.unitNumber ?? ""} /></label>
            <label className="field field-wide"><span>Street address</span><input name="streetAddress" required defaultValue={initial.property.streetAddress} /></label>
            <label className="field"><span>Neighbourhood</span><input name="neighbourhood" defaultValue={initial.property.neighbourhood ?? ""} /></label>
            <label className="field"><span>City</span><input name="city" required defaultValue={initial.property.city} /></label>
            <label className="field"><span>Province</span><select name="provinceCode" defaultValue={initial.property.provinceCode ?? "BC"}>
              <option value="">Select province</option><option value="BC">British Columbia</option><option value="AB">Alberta</option>
              <option value="ON">Ontario</option><option value="QC">Quebec</option>
            </select></label>
            <label className="field"><span>Postal code</span><input name="postalCode" autoCapitalize="characters" placeholder="V6X 4K2" defaultValue={initial.property.postalCode ?? ""} /></label>
            <label className="field"><span>Country</span><input readOnly value="Canada" /></label>
          </div>
        </FormCard>

        <FormCard number={2} title="Rent, layout, and availability">
          <div className="field-grid">
            <label className="field"><span>Monthly rent (CAD)</span><input name="monthlyRent" type="number" min="1" step="0.01" required defaultValue={initial.pricing.monthlyRentCents ? initial.pricing.monthlyRentCents / 100 : ""} /></label>
            <label className="field"><span>Bedrooms</span><input name="bedrooms" type="number" min="0" step="0.5" required defaultValue={initial.layout.bedrooms} /></label>
            <label className="field"><span>Bathrooms</span><input name="bathrooms" type="number" min="0" step="0.5" required defaultValue={initial.layout.bathrooms} /></label>
            <label className="field"><span>Dens</span><input name="denCount" type="number" min="0" step="1" defaultValue={initial.layout.denCount} /></label>
            <label className="field"><span>Square feet</span><input name="squareFeet" type="number" min="1" defaultValue={initial.layout.squareFeet ?? ""} /></label>
            <label className="field"><span>Furnishing</span><select name="furnishedStatus" defaultValue={initial.layout.furnishedStatus ?? ""}>
              <option value="">Select furnishing</option><option value="unfurnished">Unfurnished</option>
              <option value="furnished">Furnished</option><option value="partly_furnished">Partly furnished</option>
            </select></label>
          </div>
          <fieldset className="choice-group"><legend>Availability</legend>
            {([["available_now", "Available now"], ["available_on", "Available on a date"], ["contact", "Contact for availability"]] as const).map(([value, label]) => (
              <label className="radio-field" key={value}><input type="radio" name="availabilityStatus" value={value}
                defaultChecked={initial.availability.status === value} onChange={() => setAvailability(value)} />{label}</label>
            ))}
          </fieldset>
          {availability === "available_on" && <label className="field conditional-field"><span>Available date</span><input name="availableOn" type="date" required defaultValue={initial.availability.availableOn ?? ""} /></label>}
          <div className="field-grid">
            <label className="field"><span>Lease type</span><select name="leaseType" value={leaseType} onChange={(event) => setLeaseType(event.target.value)}>
              <option value="">Select lease type</option><option value="fixed_term">Fixed term</option>
              <option value="month_to_month">Month-to-month</option><option value="flexible">Flexible</option>
            </select></label>
            {leaseType === "fixed_term" && <label className="field"><span>Minimum lease (months)</span><input name="minimumLeaseMonths" type="number" min="1" max="120" required defaultValue={initial.availability.minimumLeaseMonths ?? 12} /></label>}
          </div>
        </FormCard>

        <FormCard number={3} title="Parking and storage">
          <label className="check-field"><input type="checkbox" name="parkingAvailable" defaultChecked={parkingAvailable} onChange={(event) => setParkingAvailable(event.target.checked)} />Parking available</label>
          {parkingAvailable && <div className="field-grid conditional-panel">
            <label className="field"><span>Parking type</span><select name="parkingType" required defaultValue={initial.parking.type ?? ""}>
              <option value="">Select type</option><option value="underground">Underground</option><option value="garage">Garage</option>
              <option value="surface">Surface</option><option value="street">Street</option><option value="carport">Carport</option><option value="other">Other</option>
            </select></label>
            <label className="field"><span>Number of stalls</span><input name="parkingStalls" type="number" min="0" required defaultValue={initial.parking.stalls ?? 1} /></label>
            <label className="check-field"><input type="checkbox" name="parkingIncluded" defaultChecked={Boolean(initial.parking.included)} />Included in rent</label>
          </div>}
          <label className="check-field"><input type="checkbox" name="visitorParkingAvailable" defaultChecked={initial.parking.visitorAvailable} />Visitor parking available</label>
          <label className="field"><span>Parking notes</span><textarea name="parkingNotes" rows={2} defaultValue={initial.parking.notes ?? ""} /></label>
          <label className="check-field"><input type="checkbox" name="storageAvailable" defaultChecked={storageAvailable} onChange={(event) => setStorageAvailable(event.target.checked)} />Storage available</label>
          {storageAvailable && <div className="field-grid conditional-panel">
            <label className="field"><span>Number of lockers</span><input name="storageLockers" type="number" min="0" required defaultValue={initial.storage.lockers ?? 1} /></label>
            <label className="check-field"><input type="checkbox" name="storageIncluded" defaultChecked={Boolean(initial.storage.included)} />Included in rent</label>
          </div>}
          <label className="field"><span>Storage notes</span><textarea name="storageNotes" rows={2} defaultValue={initial.storage.notes ?? ""} /></label>
        </FormCard>

        <FormCard number={4} title="Pets, smoking, and application requirements">
          <fieldset className="choice-group"><legend>Pet policy</legend>
            {([["not_allowed", "Not allowed"], ["considered", "Considered"], ["allowed", "Allowed"]] as const).map(([value, label]) => (
              <label className="radio-field" key={value}><input type="radio" name="petStatus" value={value}
                defaultChecked={initial.pets.status === value} onChange={() => setPetStatus(value)} />{label}</label>
            ))}
          </fieldset>
          {petStatus && petStatus !== "not_allowed" && <div className="conditional-panel">
            <label className="check-field"><input type="checkbox" name="catsAllowed" defaultChecked={initial.pets.catsAllowed} />Cats</label>
            <label className="check-field"><input type="checkbox" name="dogsAllowed" defaultChecked={initial.pets.dogsAllowed} />Dogs</label>
            <div className="field-grid">
              <label className="field"><span>Maximum pets</span><input name="petMaxCount" type="number" min="1" defaultValue={initial.pets.maxCount ?? ""} /></label>
              <label className="field"><span>Size limit (lbs)</span><input name="petSizeLimitLbs" type="number" min="1" defaultValue={initial.pets.sizeLimitLbs ?? ""} /></label>
            </div>
          </div>}
          <label className="field"><span>Pet notes</span><textarea name="petNotes" rows={2} defaultValue={initial.pets.notes ?? ""} /></label>
          <fieldset className="choice-group"><legend>Smoking policy</legend>
            {([["not_allowed", "No smoking"], ["outdoor_only", "Outdoor only"], ["allowed", "Allowed"], ["contact", "Contact for details"]] as const).map(([value, label]) => (
              <label className="radio-field" key={value}><input type="radio" name="smokingPolicy" value={value} defaultChecked={initial.smokingPolicy === value} />{label}</label>
            ))}
          </fieldset>
          <label className="check-field"><input type="checkbox" name="creditCheckRequired" defaultChecked={initial.applicationRequirements.creditCheckRequired} />Credit check required</label>
          <label className="check-field"><input type="checkbox" name="referencesRequired" defaultChecked={initial.applicationRequirements.referencesRequired} />References required</label>
        </FormCard>

        <FormCard number={5} title="Utilities included in monthly rent">
          <div className="checkbox-grid">
            {utilityOptions.map(([code, label]) => <label className="check-field" key={code}><input type="checkbox" name="includedUtilityCodes" value={code} defaultChecked={initial.includedUtilityCodes.includes(code)} />{label}</label>)}
          </div>
          <label className="field"><span>Additional utility notes</span><textarea name="utilitiesNotes" rows={2} defaultValue={initial.utilitiesNotes ?? ""} /></label>
        </FormCard>

        <FormCard number={6} title="Features and amenities">
          <div className="amenity-groups">
            {amenityGroups.map((group) => <fieldset className="choice-group" key={group.label}><legend>{group.label}</legend>
              <div className="checkbox-grid">{group.items.map(([code, label]) => <label className="check-field" key={code}><input type="checkbox" name="amenityCodes" value={code} defaultChecked={initial.amenityCodes.includes(code)} />{label}</label>)}</div>
            </fieldset>)}
          </div>
          <label className="field"><span>Additional feature notes</span><textarea name="amenityNotes" rows={2} defaultValue={initial.amenityNotes ?? ""} /></label>
        </FormCard>

        <FormCard number={7} title="Fees and deposits">
          {fees.map((fee, index) => <div className="fee-row" key={fee.key}>
            <div className="field-grid">
              <label className="field"><span>Fee type</span><select name={`feeType-${fee.key}`} defaultValue={fee.feeType}>
                <option value="security_deposit">Security deposit</option><option value="pet_deposit">Pet deposit</option>
                <option value="parking">Parking</option><option value="storage">Storage</option>
                <option value="move_in">Move-in</option><option value="other">Other</option>
              </select></label>
              <label className="field"><span>Label (for other)</span><input name={`feeLabel-${fee.key}`} defaultValue={fee.label ?? ""} /></label>
              <label className="field"><span>Amount (CAD)</span><input name={`feeAmount-${fee.key}`} type="number" min="0.01" step="0.01" required defaultValue={fee.amountCents / 100 || ""} /></label>
              <label className="field"><span>Frequency</span><select name={`feeFrequency-${fee.key}`} defaultValue={fee.frequency}><option value="one_time">One time</option><option value="monthly">Monthly</option></select></label>
            </div>
            <label className="check-field"><input type="checkbox" name={`feeRequired-${fee.key}`} defaultChecked={fee.required} />Required</label>
            <label className="check-field"><input type="checkbox" name={`feeRefundable-${fee.key}`} defaultChecked={fee.refundable} />Refundable</label>
            <label className="field"><span>Notes</span><input name={`feeNotes-${fee.key}`} defaultValue={fee.notes ?? ""} /></label>
            <button className="icon-text-button" type="button" onClick={() => setFees((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}>Remove fee</button>
          </div>)}
          <button className="button secondary" type="button" onClick={() => setFees((rows) => [...rows, newFeeRow()])}>Add fee</button>
        </FormCard>

        <FormCard number={8} title="Contact">
          <label className="check-field"><input type="checkbox" name="useSiteContact" checked={!customContact} onChange={(event) => setCustomContact(!event.target.checked)} />Use Ting Ting’s website contact information</label>
          {customContact && <div className="field-grid conditional-panel">
            <label className="field"><span>Contact or manager name</span><input name="contactName" required defaultValue={initial.contact.name ?? ""} /></label>
            <label className="field"><span>Phone</span><input name="contactPhone" type="tel" defaultValue={initial.contact.phone ?? ""} /></label>
            <label className="field"><span>Email</span><input name="contactEmail" type="email" defaultValue={initial.contact.email ?? ""} /></label>
          </div>}
        </FormCard>

        <FormCard number={9} title="Description and photos">
          <label className="field field-wide"><span>Listing description</span><textarea name="description" rows={8} required defaultValue={initial.description} /><small>Describe the layout, views, finishes, location, and what makes the home distinctive.</small></label>
          <fieldset className="rental-images">
            <legend>Photos (up to 20) — exactly one cover is required to publish</legend>
            <div className="media-grid">
              {selectedMedia.map((asset) => <article className="media-card selectable selected" key={asset.id}>
                {asset.previewUrl ? <Image src={asset.previewUrl} alt={asset.altText} width={240} height={150} unoptimized={asset.previewUrl.startsWith("data:")} /> : <div className="media-placeholder">Preview unavailable</div>}
                <div>
                  <label className="check-field"><input type="checkbox" checked onChange={(event) => {
                    setSelectedImages((items) => event.target.checked ? [...items, asset.id] : items.filter((id) => id !== asset.id));
                    if (!event.target.checked && coverMediaAssetId === asset.id) setCoverMediaAssetId("");
                  }} />Use image</label>
                  <label className="radio-field"><input type="radio" name="coverMediaAssetId" checked={coverMediaAssetId === asset.id} onChange={() => setCoverMediaAssetId(asset.id)} />Cover image</label>
                  <div className="image-order-actions">
                    <button className="icon-text-button" type="button" onClick={() => moveImage(asset.id, -1, selectedImages, setSelectedImages)}>Move earlier</button>
                    <button className="icon-text-button" type="button" onClick={() => moveImage(asset.id, 1, selectedImages, setSelectedImages)}>Move later</button>
                  </div>
                </div>
              </article>)}
              <MediaLibrary assets={media} onAssetsChanged={updateMedia} showExistingAssets={false} summaryLabel="+ Add" />
            </div>
          </fieldset>
        </FormCard>

        <section className="prototype-form-card completeness-card" aria-labelledby="completeness-heading">
          <h2 id="completeness-heading">Completeness preview</h2>
          <p>{selectedImages.length} photo{selectedImages.length === 1 ? "" : "s"} selected · {coverMediaAssetId ? "Cover selected" : "Cover still needed"} · {initial.amenityCodes.length} saved amenities.</p>
          <details><summary>Advanced and system-managed details</summary>
            <label className="field rental-slug-field"><span>URL slug</span><input name="slug" required minLength={2} maxLength={100} readOnly={Boolean(current?.publishedAt)} value={slug} onChange={(event) => setSlug(normalizeRentalSlug(event.target.value))} /></label>
            <p>Homepage order and source identity are managed outside this listing form.</p>
          </details>
        </section>

        <div className="sticky-rental-actions">
          <div>{current && current.status !== "archived" && <button className="button danger-outline" disabled={busy} type="button" onClick={() => void statusAction("archive")}>Archive</button>}</div>
          <div className="admin-action-bar">
            <button className="button secondary" disabled={busy} type="submit">Save privately</button>
            {current && current.status !== "archived" && <Link className="button secondary" href={`/admin/rentals/${current.id}/preview`}>Preview saved draft</Link>}
            {current && current.status !== "archived" && <button className="button" disabled={busy} type="button" onClick={() => void publishCurrentForm()}>{current.status === "published" ? "Publish updates" : "Publish to website"}</button>}
            {current?.status === "published" && <button className="button secondary" disabled={busy} type="button" onClick={() => void statusAction("unpublish")}>Remove from website</button>}
          </div>
        </div>
        {message && <p className="admin-save-status" aria-live="polite">{message}</p>}
      </form>
    </div>
  );
}

function FormCard({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return <section className="prototype-form-card rental-form-card" id={`rental-card-${number}`}><h2><span>{number}</span>{title}</h2>{children}</section>;
}

function emptyRental(): RentalListingV2Input {
  return {
    slug: "new-rental", title: "",
    property: {
      id: null, expectedVersion: null, propertyType: "apartment", buildingName: null,
      unitNumber: null, streetAddress: "", neighbourhood: null, city: "Vancouver",
      provinceCode: "BC", postalCode: null, countryCode: "CA"
    },
    pricing: { monthlyRentCents: 0, currencyCode: "CAD" },
    layout: { bedrooms: 1, bathrooms: 1, denCount: 0, squareFeet: null, furnishedStatus: null },
    availability: { status: null, availableOn: null, leaseType: null, minimumLeaseMonths: null },
    parking: { available: false, type: null, stalls: null, included: null, visitorAvailable: false, notes: null },
    storage: { available: false, lockers: null, included: null, notes: null },
    pets: { status: null, catsAllowed: false, dogsAllowed: false, maxCount: null, sizeLimitLbs: null, notes: null },
    smokingPolicy: null,
    applicationRequirements: { creditCheckRequired: false, referencesRequired: false },
    amenityCodes: [], includedUtilityCodes: [], fees: [],
    contact: { mode: "site_default", name: null, email: null, phone: null },
    utilitiesNotes: null, amenityNotes: null, description: "", images: []
  };
}

function newFeeRow(): FeeRow {
  return {
    key: crypto.randomUUID(), feeType: "security_deposit", label: null,
    amountCents: 0, frequency: "one_time", refundable: true,
    required: true, notes: null, sortOrder: 0
  };
}

function statusLabel(rental: RentalListing | null, hasChanges: boolean) {
  if (!rental) return "Not saved";
  if (rental.status === "archived") return "Archived";
  if (rental.status === "published") return hasChanges ? "Live with unpublished changes" : "Live on website";
  return "Saved privately";
}

function moveImage(id: string, direction: -1 | 1, images: string[], setImages: (images: string[]) => void) {
  const index = images.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= images.length) return;
  const next = [...images];
  [next[index], next[target]] = [next[target], next[index]];
  setImages(next);
}

function normalizeRentalSlug(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
    .replace(/&/g, "-and-").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-").slice(0, 100).replace(/-+$/g, "");
}

function rentalSaveError(result: {
  error?: { code?: string; message?: string; details?: Array<{ path?: Array<string | number> }>; };
}) {
  if (result.error?.code === "VALIDATION_ERROR") {
    const path = result.error.details?.[0]?.path?.join(".");
    return path ? `Check ${path} and try again.` : "Check the rental fields and try again.";
  }
  if (result.error?.code === "PUBLISH_REQUIREMENTS_MISSING") {
    return "This draft is saved, but it is not ready to publish. Complete the missing publish fields and choose one cover image.";
  }
  if (result.error?.code === "DATABASE_ERROR") return "The listing could not be saved because the database is unavailable. Your last confirmed save is unchanged.";
  if (result.error?.code === "VERSION_CONFLICT") return "This listing or property changed in another tab. Refresh before saving again.";
  return result.error?.message ?? "Rental could not be saved.";
}
