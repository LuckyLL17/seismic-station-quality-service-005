export type Station = { id: string; code: string; name: string; region: string; elevationM: number; status: 'online' | 'maintenance' | 'offline'; lastSeenAt: string };
export type Observation = { id: string; stationId: string; observedAt: string; samples: number; sampleRateHz: number; peakAmplitude: number; timingOffsetMs: number; qualityScore: number; issues: string[] };
export type QualityReport = { id: string; stationId: string; windowStart: string; windowEnd: string; observationCount: number; averageScore: number; issues: string[]; generatedAt: string };
export type IncidentStatus = 'open' | 'acknowledged' | 'assigned' | 'resolved' | 'closed';
export type IncidentAction = 'created' | 'acknowledged' | 'assigned' | 'resolved' | 'closed' | 'reopened';
export type IncidentHistoryEntry = { at: string; action: IncidentAction; actor: string; note?: string; assignee?: string };
export type QualityIncident = { id: string; stationId: string; issueType: string; status: IncidentStatus; observationIds: string[]; occurrenceCount: number; firstSeenAt: string; lastSeenAt: string; assignee: string | null; history: IncidentHistoryEntry[]; createdAt: string; updatedAt: string; resolvedAt: string | null; closedAt: string | null };
export type IncidentInconsistency = { incidentId: string; stationId: string; issueType: string; status: IncidentStatus; kind: 'active_but_issue_gone' | 'inactive_but_issue_present'; detail: string };
