import { randomUUID } from 'node:crypto';
import type { IncidentAction, IncidentInconsistency, IncidentStatus, Observation, QualityIncident, QualityReport, Station } from './types.js';

export const stations: Station[] = [
  { id: 'st-001', code: 'QZ-A01', name: '青岚台站', region: '川西断裂带', elevationM: 1840, status: 'online', lastSeenAt: new Date().toISOString() },
  { id: 'st-002', code: 'QZ-B07', name: '白石台站', region: '龙门山南段', elevationM: 920, status: 'online', lastSeenAt: new Date().toISOString() },
  { id: 'st-003', code: 'QZ-C12', name: '岷江台站', region: '岷江河谷', elevationM: 2470, status: 'maintenance', lastSeenAt: new Date().toISOString() }
];
export const observations: Observation[] = [];
export const reports: QualityReport[] = [];
export const incidents: QualityIncident[] = [];

const ACTIVE_STATUSES: IncidentStatus[] = ['open', 'acknowledged', 'assigned'];
export type IncidentTarget = Exclude<IncidentStatus, 'open'>;
const TRANSITIONS: Record<IncidentTarget, IncidentStatus[]> = {
  acknowledged: ['open'],
  assigned: ['open', 'acknowledged', 'assigned'],
  resolved: ['open', 'acknowledged', 'assigned'],
  closed: ['resolved']
};

export function createReport(stationId: string, start: string, end: string): QualityReport {
  const rows = observations.filter(item => item.stationId === stationId && item.observedAt >= start && item.observedAt <= end);
  const averageScore = rows.length ? Math.round(rows.reduce((sum, item) => sum + item.qualityScore, 0) / rows.length) : 0;
  const issues = [...new Set(rows.flatMap(item => item.issues))];
  const report = { id: randomUUID(), stationId, windowStart: start, windowEnd: end, observationCount: rows.length, averageScore, issues, generatedAt: new Date().toISOString() };
  reports.push(report); return report;
}

export function findDuplicateObservation(stationId: string, observedAt: string): Observation | undefined {
  return observations.find(item => item.stationId === stationId && item.observedAt === observedAt);
}

export function activeIncidentFor(stationId: string, issueType: string): QualityIncident | undefined {
  return incidents.find(item => item.stationId === stationId && item.issueType === issueType && ACTIVE_STATUSES.includes(item.status));
}

function latestIncidentFor(stationId: string, issueType: string): QualityIncident | undefined {
  return incidents.filter(item => item.stationId === stationId && item.issueType === issueType).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))[0];
}

function pushHistory(incident: QualityIncident, action: IncidentAction, actor: string, note?: string, assignee?: string): void {
  const at = new Date().toISOString();
  incident.history.push({ at, action, actor, ...(note ? { note } : {}), ...(assignee ? { assignee } : {}) });
  incident.updatedAt = at;
}

export function transitionIncident(incident: QualityIncident, target: IncidentTarget, actor: string, note?: string, assignee?: string): string | null {
  if (!TRANSITIONS[target].includes(incident.status)) return `事件当前状态为 ${incident.status}，不允许流转到 ${target}`;
  if (target === 'assigned' && !assignee) return '转派时必须指定处理人 assignee';
  incident.status = target;
  if (target === 'assigned') incident.assignee = assignee!;
  if (target === 'resolved') incident.resolvedAt = new Date().toISOString();
  if (target === 'closed') incident.closedAt = new Date().toISOString();
  pushHistory(incident, target, actor, note, assignee);
  return null;
}

export function reopenIncident(incident: QualityIncident, actor: string, note?: string): void {
  incident.status = 'open';
  incident.resolvedAt = null;
  incident.closedAt = null;
  pushHistory(incident, 'reopened', actor, note);
}

export function syncIncidentsForObservation(observation: Observation): QualityIncident[] {
  const touched = new Set<QualityIncident>();
  const now = new Date().toISOString();
  for (const issueType of observation.issues) {
    const latest = latestIncidentFor(observation.stationId, issueType);
    if (latest && observation.observedAt <= latest.lastSeenAt) {
      // 重复或乱序补录的观测：仅补充关联，不改变事件状态
      if (!latest.observationIds.includes(observation.id)) { latest.observationIds.push(observation.id); latest.occurrenceCount += 1; latest.updatedAt = now; }
      touched.add(latest);
    } else if (latest && ACTIVE_STATUSES.includes(latest.status)) {
      latest.observationIds.push(observation.id);
      latest.occurrenceCount += 1;
      latest.lastSeenAt = observation.observedAt;
      latest.updatedAt = now;
      touched.add(latest);
    } else {
      // 首次出现，或恢复后再次发生：开启新事件
      const incident: QualityIncident = { id: randomUUID(), stationId: observation.stationId, issueType, status: 'open', observationIds: [observation.id], occurrenceCount: 1, firstSeenAt: observation.observedAt, lastSeenAt: observation.observedAt, assignee: null, history: [], createdAt: now, updatedAt: now, resolvedAt: null, closedAt: null };
      pushHistory(incident, 'created', 'system', latest ? '问题恢复后再次发生，重新开启事件' : '检测到质量问题，自动创建事件');
      incidents.push(incident);
      touched.add(incident);
    }
  }
  // 本次观测未再出现的问题：对应活动事件自动恢复（仅当观测不早于事件最近发生时间，避免乱序数据误恢复）
  for (const incident of incidents.filter(item => item.stationId === observation.stationId && ACTIVE_STATUSES.includes(item.status) && !observation.issues.includes(item.issueType) && observation.observedAt >= item.lastSeenAt)) {
    transitionIncident(incident, 'resolved', 'system', `观测 ${observation.id} 未再出现「${incident.issueType}」，自动恢复`);
    touched.add(incident);
  }
  return [...touched];
}

export function detectInconsistencies(): IncidentInconsistency[] {
  const result: IncidentInconsistency[] = [];
  for (const incident of incidents) {
    const rows = observations.filter(item => item.stationId === incident.stationId).sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    const latest = rows[rows.length - 1];
    if (!latest) continue;
    const present = latest.issues.includes(incident.issueType);
    if (ACTIVE_STATUSES.includes(incident.status) && !present) result.push({ incidentId: incident.id, stationId: incident.stationId, issueType: incident.issueType, status: incident.status, kind: 'active_but_issue_gone', detail: `事件仍处于 ${incident.status}，但最新观测 ${latest.id} 已未出现该问题` });
    // 已恢复/已关闭但问题仍在：仅当没有新的活动事件在处理时才视为不一致（恢复后再次发生会开新事件，旧事件不算异常）
    if ((incident.status === 'resolved' || incident.status === 'closed') && present && !activeIncidentFor(incident.stationId, incident.issueType)) result.push({ incidentId: incident.id, stationId: incident.stationId, issueType: incident.issueType, status: incident.status, kind: 'inactive_but_issue_present', detail: `事件已 ${incident.status}，但最新观测 ${latest.id} 仍出现该问题` });
  }
  return result;
}

export function reconcileIncidents(actor: string): { checked: number; found: number; fixed: IncidentInconsistency[]; skipped: IncidentInconsistency[] } {
  const found = detectInconsistencies();
  const fixed: IncidentInconsistency[] = [];
  const skipped: IncidentInconsistency[] = [];
  for (const item of found) {
    const incident = incidents.find(entry => entry.id === item.incidentId)!;
    if (item.kind === 'active_but_issue_gone') {
      if (transitionIncident(incident, 'resolved', actor, '状态与原始观测不一致，对账自动恢复') === null) fixed.push(item); else skipped.push(item);
    } else if (activeIncidentFor(incident.stationId, incident.issueType)) {
      skipped.push(item); // 同一台站+问题已有新的活动事件在处理，无需重开
    } else {
      reopenIncident(incident, actor, '状态与原始观测不一致，对账重新打开');
      fixed.push(item);
    }
  }
  return { checked: incidents.length, found: found.length, fixed, skipped };
}
