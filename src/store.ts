import { randomUUID } from 'node:crypto';
import type { IncidentConsistency, Observation, QualityIncident, QualityReport, Station } from './types.js';

export const stations: Station[] = [
  { id: 'st-001', code: 'QZ-A01', name: '青岚台站', region: '川西断裂带', elevationM: 1840, status: 'online', lastSeenAt: new Date().toISOString() },
  { id: 'st-002', code: 'QZ-B07', name: '白石台站', region: '龙门山南段', elevationM: 920, status: 'online', lastSeenAt: new Date().toISOString() },
  { id: 'st-003', code: 'QZ-C12', name: '岷江台站', region: '岷江河谷', elevationM: 2470, status: 'maintenance', lastSeenAt: new Date().toISOString() }
];
export const observations: Observation[] = [];
export const reports: QualityReport[] = [];
export function createReport(stationId: string, start: string, end: string): QualityReport {
  const rows = observations.filter(item => item.stationId === stationId && item.observedAt >= start && item.observedAt <= end);
  const averageScore = rows.length ? Math.round(rows.reduce((sum, item) => sum + item.qualityScore, 0) / rows.length) : 0;
  const issues = [...new Set(rows.flatMap(item => item.issues))];
  const report = { id: randomUUID(), stationId, windowStart: start, windowEnd: end, observationCount: rows.length, averageScore, issues, generatedAt: new Date().toISOString() };
  reports.push(report); return report;
}

export const incidents: QualityIncident[] = [];

// 同站同类型问题聚合为一次事件；已恢复/关闭后复发则重开最近的事件
export function recordIssueObservation(stationId: string, issueType: string, observation: Observation): QualityIncident {
  const now = new Date().toISOString();
  const active = incidents.find(item => item.stationId === stationId && item.issueType === issueType && item.status !== 'resolved' && item.status !== 'closed');
  if (active) {
    if (!active.observationIds.includes(observation.id)) {
      active.observationIds.push(observation.id);
      active.occurrenceCount += 1;
      active.lastSeenAt = observation.observedAt;
      active.history.push({ at: now, action: 'occurrence' });
    }
    return active;
  }
  const previous = [...incidents].reverse().find(item => item.stationId === stationId && item.issueType === issueType);
  if (previous) {
    previous.status = 'open';
    previous.resolvedAt = undefined;
    previous.closedAt = undefined;
    if (!previous.observationIds.includes(observation.id)) {
      previous.observationIds.push(observation.id);
      previous.occurrenceCount += 1;
    }
    previous.lastSeenAt = observation.observedAt;
    previous.history.push({ at: now, action: 'reopened', note: '问题恢复后再次发生' });
    return previous;
  }
  const incident: QualityIncident = { id: randomUUID(), stationId, issueType, status: 'open', observationIds: [observation.id], occurrenceCount: 1, firstSeenAt: observation.observedAt, lastSeenAt: observation.observedAt, history: [{ at: now, action: 'created' }] };
  incidents.push(incident);
  return incident;
}

// 校验事件状态与原始观测是否一致
export function checkIncidentConsistency(incident: QualityIncident): IncidentConsistency {
  const linked = observations.filter(item => incident.observationIds.includes(item.id));
  const failing = linked.filter(item => item.issues.includes(incident.issueType));
  const problems: string[] = [];
  const missing = incident.observationIds.length - linked.length;
  if (missing > 0) problems.push(`有 ${missing} 条关联观测已不存在`);
  if (incident.status === 'resolved' || incident.status === 'closed') {
    const settledAt = incident.closedAt ?? incident.resolvedAt;
    const lateFailures = failing.filter(item => !settledAt || item.observedAt > settledAt);
    if (lateFailures.length > 0) problems.push(`事件已${incident.status === 'resolved' ? '恢复' : '关闭'}，但之后仍有 ${lateFailures.length} 条观测出现该问题`);
  } else {
    const latest = [...observations].reverse().find(item => item.stationId === incident.stationId);
    if (latest && !latest.issues.includes(incident.issueType)) problems.push('事件未恢复，但最新观测已无该问题，建议恢复或执行对账');
  }
  return { consistent: problems.length === 0, problems, linkedObservations: linked.length, failingObservations: failing.length };
}
