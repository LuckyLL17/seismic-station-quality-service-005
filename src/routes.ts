import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { activeIncidentFor, createReport, detectInconsistencies, findDuplicateObservation, incidents, observations, reconcileIncidents, reports, stations, syncIncidentsForObservation, transitionIncident } from './store.js';
import type { IncidentTarget } from './store.js';

const ingestSchema = z.object({ stationId: z.string(), observedAt: z.string().datetime().optional(), samples: z.number().int().nonnegative(), sampleRateHz: z.number().positive(), peakAmplitude: z.number().nonnegative(), timingOffsetMs: z.number() });
const reportSchema = z.object({ stationId: z.string(), windowStart: z.string().datetime(), windowEnd: z.string().datetime() });
const incidentActionSchema = z.object({ operator: z.string().min(1), note: z.string().optional() });
const incidentAssignSchema = z.object({ operator: z.string().min(1), assignee: z.string().min(1), note: z.string().optional() });

function handleIncidentAction(request: FastifyRequest, reply: FastifyReply, target: IncidentTarget) {
  const { id } = request.params as { id: string };
  const incident = incidents.find(item => item.id === id);
  if (!incident) return reply.code(404).send({ error: '事件不存在' });
  const schema = target === 'assigned' ? incidentAssignSchema : incidentActionSchema;
  const parsed = schema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: '参数校验失败', details: parsed.error.flatten() });
  const data = parsed.data as { operator: string; note?: string; assignee?: string };
  const error = transitionIncident(incident, target, data.operator, data.note, data.assignee);
  if (error) return reply.code(409).send({ error, incident });
  return reply.send(incident);
}

export async function registerRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ status: 'ok', service: 'seismic-station-quality-service', workflow: '接收台站数据 → 检测完整性 → 计算质量分 → 聚合质量事件 → 生成质量报告' }));
  app.get('/api/stations', async () => stations);
  app.post('/api/stations', async (request, reply) => { const body = request.body as Partial<(typeof stations)[number]>; const station = { id: randomUUID(), code: body.code ?? `QZ-${stations.length + 1}`, name: body.name ?? '未命名台站', region: body.region ?? '未设置', elevationM: body.elevationM ?? 0, status: body.status ?? 'offline', lastSeenAt: new Date().toISOString() } as (typeof stations)[number]; stations.push(station); return reply.code(201).send(station); });
  app.post('/api/observations/ingest', async (request, reply) => {
    const parsed = ingestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: '参数校验失败', details: parsed.error.flatten() });
    const input = parsed.data;
    const station = stations.find(item => item.id === input.stationId);
    if (!station) return reply.code(404).send({ error: '台站不存在' });
    if (input.observedAt) {
      const duplicate = findDuplicateObservation(input.stationId, input.observedAt);
      if (duplicate) return reply.code(200).send({ ...duplicate, duplicate: true });
    }
    const issues: string[] = [];
    if (input.samples < input.sampleRateHz * 30) issues.push('采样窗口不足');
    if (input.peakAmplitude > 0.95) issues.push('波形削顶风险');
    if (Math.abs(input.timingOffsetMs) > 5) issues.push('时间同步偏差');
    const qualityScore = Math.max(0, Math.round(100 - issues.length * 22 - Math.min(Math.abs(input.timingOffsetMs), 20)));
    const observation = { id: randomUUID(), ...input, observedAt: input.observedAt ?? new Date().toISOString(), qualityScore, issues };
    observations.push(observation);
    station.lastSeenAt = observation.observedAt;
    station.status = 'online';
    const touched = syncIncidentsForObservation(observation);
    return reply.code(201).send({ ...observation, incidentIds: touched.map(item => item.id) });
  });
  app.get('/api/observations', async (request) => { const query = request.query as { stationId?: string; minScore?: string }; return observations.filter(item => (!query.stationId || item.stationId === query.stationId) && (!query.minScore || item.qualityScore >= Number(query.minScore))); });
  app.post('/api/quality/reports/run', async (request, reply) => { const parsed = reportSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: '参数校验失败', details: parsed.error.flatten() }); if (!stations.some(item => item.id === parsed.data.stationId)) return reply.code(404).send({ error: '台站不存在' }); return reply.code(201).send(createReport(parsed.data.stationId, parsed.data.windowStart, parsed.data.windowEnd)); });
  app.get('/api/quality/reports', async (request) => { const query = request.query as { stationId?: string }; return reports.filter(item => !query.stationId || item.stationId === query.stationId); });
  app.get('/api/incidents', async (request) => { const query = request.query as { stationId?: string; status?: string; issueType?: string }; return incidents.filter(item => (!query.stationId || item.stationId === query.stationId) && (!query.status || item.status === query.status) && (!query.issueType || item.issueType === query.issueType)); });
  app.get('/api/incidents/inconsistencies', async () => { const items = detectInconsistencies(); return { count: items.length, items }; });
  app.post('/api/incidents/reconcile', async (request) => { const body = (request.body ?? {}) as { operator?: string }; return reconcileIncidents(body.operator ?? 'system'); });
  app.get('/api/incidents/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const incident = incidents.find(item => item.id === id);
    if (!incident) return reply.code(404).send({ error: '事件不存在' });
    return { ...incident, observations: observations.filter(item => incident.observationIds.includes(item.id)) };
  });
  app.post('/api/incidents/:id/acknowledge', async (request, reply) => handleIncidentAction(request, reply, 'acknowledged'));
  app.post('/api/incidents/:id/assign', async (request, reply) => handleIncidentAction(request, reply, 'assigned'));
  app.post('/api/incidents/:id/resolve', async (request, reply) => handleIncidentAction(request, reply, 'resolved'));
  app.post('/api/incidents/:id/close', async (request, reply) => handleIncidentAction(request, reply, 'closed'));
}
