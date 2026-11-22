// Internal (staff) view of a farmer + farm. Partners get the much smaller shape in verification.service.js.
export function farmerView(farmer, farm) {
  const f = farmer.toObject ? farmer.toObject() : farmer;
  const m = farm ? (farm.toObject ? farm.toObject() : farm) : null;
  return {
    id: String(f._id),
    farmaslogId: f.farmaslogId ?? null,
    name: f.name,
    phone: f.phoneNormalized ?? null,
    sharedPhone: !!f.sharedPhone,
    contactVia: f.contactVia?.type ? { type: f.contactVia.type, name: f.contactVia.name ?? null, phone: f.contactVia.phoneNormalized ?? null, relationship: f.contactVia.relationship ?? null } : null,
    state: f.state, lga: f.lga, ward: f.ward, community: f.community,
    status: f.status,
    source: f.source,
    isSynthetic: f.isSynthetic,
    sourceRef: f.sourceRef,
    sourceChannel: f.sourceChannel,
    submittedAt: f.submittedAt,
    programmeRequested: f.programmeRequested,
    consent: f.consent,
    consentStatus: f.consentStatus ?? 'valid',
    createdAt: f.createdAt, updatedAt: f.updatedAt,
    farm: m && {
      crop: m.crop,
      reportedArea: m.reportedArea,
      estimatedArea: m.estimatedArea,
      location: m.location,
      enrichment: { state: m.enrichment?.state, reason: m.enrichment?.reason },
      evidence: m.evidence,
      fieldVerification: m.fieldVerification && {
        outcome: m.fieldVerification.outcome, method: m.fieldVerification.method, verifiedAt: m.fieldVerification.verifiedAt,
      },
      files: (m.files || []).map((x) => ({ id: String(x._id), originalName: x.originalName, mimeType: x.mimeType, size: x.size, uploadedAt: x.uploadedAt })),
    },
  };
}
