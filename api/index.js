import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, data, status = 200) {
  cors(res);
  res.status(status).json(data);
}

async function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
  });
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Strip /api prefix and query string to get clean path
  const rawPath = req.url.split('?')[0].replace(/^\/api/, '') || '/';
  const parts = rawPath.split('/').filter(Boolean);
  const path = '/' + parts.join('/');
  const query = req.query;
  const body = ['POST','PUT','PATCH'].includes(req.method) ? await parseBody(req) : {};

  // ---- PARQUÍMETROS ----
  if (path === '/parquimetros' && req.method === 'GET') {
    const { data, error } = await supabase.from('parquimetros').select('*').order('id');
    if (error) return json(res, { error: error.message }, 500);
    return json(res, data.map(p => ({ id: p.id, direccion: p.direccion, lat: p.lat, lon: p.lon })));
  }

  if (path === '/parquimetros/coords' && req.method === 'POST') {
    for (const { id, lat, lon } of body) {
      await supabase.from('parquimetros').update({ lat, lon }).eq('id', id);
    }
    return json(res, { ok: true });
  }

  // ---- BATERÍAS ----
  if (path === '/baterias' && req.method === 'GET') {
    const { data, error } = await supabase.from('baterias').select('*').order('numero');
    if (error) return json(res, { error: error.message }, 500);
    return json(res, data.map(b => ({ id: b.id, numero: b.numero, marca: b.marca, fechaIngreso: b.fecha_ingreso, notas: b.notas })));
  }

  if (path === '/baterias' && req.method === 'POST') {
    const numero = body.numero;
    if (!numero) return json(res, { error: 'Número requerido' }, 400);
    if (numero !== 'SN') {
      const { data: existing } = await supabase.from('baterias').select('id').eq('numero', numero).maybeSingle();
      if (existing) return json(res, { error: 'Ya existe una batería con ese número' }, 400);
    }
    const id = Date.now().toString();
    const { data, error } = await supabase.from('baterias').insert({
      id, numero, marca: body.marca || null,
      fecha_ingreso: body.fechaIngreso || null, notas: body.notas || null
    }).select().single();
    if (error) return json(res, { error: error.message }, 500);
    return json(res, { id: data.id, numero: data.numero, marca: data.marca, fechaIngreso: data.fecha_ingreso, notas: data.notas });
  }

  if (path.match(/^\/baterias\/[^/]+$/) && req.method === 'PUT') {
    const id = parts[1];
    const { data, error } = await supabase.from('baterias').update({
      numero: body.numero, marca: body.marca || null,
      fecha_ingreso: body.fechaIngreso || null, notas: body.notas || null
    }).eq('id', id).select().single();
    if (error) return json(res, { error: error.message }, 500);
    return json(res, { id: data.id, numero: data.numero, marca: data.marca, fechaIngreso: data.fecha_ingreso, notas: data.notas });
  }

  if (path.match(/^\/baterias\/[^/]+$/) && req.method === 'DELETE') {
    await supabase.from('baterias').delete().eq('id', parts[1]);
    return json(res, { ok: true });
  }

  // ---- CAMBIOS ----
  if (path === '/cambios' && req.method === 'GET') {
    let q = supabase.from('cambios').select('*').order('id');
    if (query.fecha) q = q.eq('fecha', query.fecha);
    const { data, error } = await q;
    if (error) return json(res, { error: error.message }, 500);
    return json(res, data.map(c => ({
      id: c.id, fecha: c.fecha,
      parquimetroId: c.parquimetro_id,
      bateriaEntraId: c.bateria_entra_id,
      bateriaSaleId: c.bateria_sale_id
    })));
  }

  if (path === '/cambios' && req.method === 'POST') {
    const { fecha, parquimetroId, bateriaEntraId, bateriaSaleId } = body;
    if (!fecha || !parquimetroId || !bateriaEntraId) return json(res, { error: 'Faltan campos' }, 400);
    const id = Date.now().toString();
    const { data, error } = await supabase.from('cambios').insert({
      id, fecha,
      parquimetro_id: parquimetroId,
      bateria_entra_id: bateriaEntraId,
      bateria_sale_id: bateriaSaleId || null
    }).select().single();
    if (error) return json(res, { error: error.message }, 500);
    return json(res, { id: data.id, fecha: data.fecha, parquimetroId: data.parquimetro_id, bateriaEntraId: data.bateria_entra_id, bateriaSaleId: data.bateria_sale_id });
  }

  if (path.match(/^\/cambios\/[^/]+$/) && req.method === 'DELETE') {
    await supabase.from('cambios').delete().eq('id', parts[1]);
    return json(res, { ok: true });
  }

  // ---- CARGADORES ----
  if (path === '/cargadores' && req.method === 'GET') {
    const { data, error } = await supabase.from('cargadores').select('*').order('cargador_num').order('slot_num');
    if (error) return json(res, { error: error.message }, 500);
    const map = {};
    for (let c = 1; c <= 5; c++) {
      map[c] = { numero: c, slots: [] };
      for (let s = 1; s <= 5; s++) map[c].slots.push({ numero: s, bateriaId: null, desde: null });
    }
    for (const row of data) {
      if (map[row.cargador_num]) {
        const slot = map[row.cargador_num].slots.find(s => s.numero === row.slot_num);
        if (slot) { slot.bateriaId = row.bateria_id; slot.desde = row.desde; }
      }
    }
    return json(res, Object.values(map));
  }

  if (path.match(/^\/cargadores\/\d+\/slot\/\d+$/) && req.method === 'PUT') {
    const cargadorNum = parseInt(parts[1]);
    const slotNum = parseInt(parts[3]);
    const { error } = await supabase.from('cargadores')
      .update({ bateria_id: body.bateriaId || null, desde: body.desde || null })
      .eq('cargador_num', cargadorNum).eq('slot_num', slotNum);
    if (error) return json(res, { error: error.message }, 500);
    return json(res, { ok: true });
  }

  // ---- STATS: ESTADO ACTUAL ----
  if (path === '/stats/estadoactual' && req.method === 'GET') {
    const { data: parqs } = await supabase.from('parquimetros').select('*').order('id');
    const { data: cambios } = await supabase.from('cambios').select('*').order('fecha', { ascending: false });
    const { data: bats } = await supabase.from('baterias').select('*');
    const batMap = {};
    for (const b of (bats || [])) batMap[b.id] = b;
    const result = (parqs || []).map(p => {
      const ultimo = (cambios || []).find(c => c.parquimetro_id === p.id);
      const bat = ultimo ? batMap[ultimo.bateria_entra_id] : null;
      return {
        id: p.id, direccion: p.direccion,
        bateria: bat ? { numero: bat.numero, marca: bat.marca, fechaIngreso: bat.fecha_ingreso } : null,
        ultimoCambio: ultimo ? ultimo.fecha : null
      };
    });
    return json(res, result);
  }

  // ---- STATS: BATERÍAS ----
  if (path === '/stats/baterias' && req.method === 'GET') {
    const { data: bats } = await supabase.from('baterias').select('*');
    const { data: cambios } = await supabase.from('cambios').select('*').order('fecha');
    const { data: parqs } = await supabase.from('parquimetros').select('id,direccion');
    const parqMap = {};
    for (const p of (parqs || [])) parqMap[p.id] = p.direccion;
    const result = (bats || []).map(bat => {
      const entraEvents = (cambios || []).filter(c => c.bateria_entra_id === bat.id);
      const saleEvents  = (cambios || []).filter(c => c.bateria_sale_id  === bat.id);
      const estadias = entraEvents.map(entrada => {
        const salida = (cambios || [])
          .filter(c => c.bateria_sale_id === bat.id && c.parquimetro_id === entrada.parquimetro_id && c.fecha >= entrada.fecha)
          .sort((a,b) => a.fecha.localeCompare(b.fecha))[0];
        const dias = salida ? Math.round((new Date(salida.fecha) - new Date(entrada.fecha)) / 86400000) : null;
        return { parquimetroId: entrada.parquimetro_id, direccion: parqMap[entrada.parquimetro_id] || '?', fechaEntrada: entrada.fecha, fechaSalida: salida ? salida.fecha : null, dias };
      });
      return { id: bat.id, numero: bat.numero, marca: bat.marca, fechaIngreso: bat.fecha_ingreso, notas: bat.notas, totalEntradas: entraEvents.length, totalSalidas: saleEvents.length, estadias };
    });
    return json(res, result);
  }

  // ---- STATS: PARQUÍMETROS ----
  if (path === '/stats/parquimetros' && req.method === 'GET') {
    const { data: parqs } = await supabase.from('parquimetros').select('*').order('id');
    const { data: cambios } = await supabase.from('cambios').select('*').order('fecha');
    const result = (parqs || []).map(parq => {
      const cc = (cambios || []).filter(c => c.parquimetro_id === parq.id).sort((a,b) => a.fecha.localeCompare(b.fecha));
      const duraciones = [];
      for (let i = 1; i < cc.length; i++) duraciones.push(Math.round((new Date(cc[i].fecha) - new Date(cc[i-1].fecha)) / 86400000));
      const promDias = duraciones.length ? Math.round(duraciones.reduce((a,b)=>a+b,0)/duraciones.length) : null;
      const minDias  = duraciones.length ? Math.min(...duraciones) : null;
      return { id: parq.id, direccion: parq.direccion, totalCambios: cc.length, promDiasPorCarga: promDias, minDiasPorCarga: minDias, bateriasBajasDuracion: duraciones.filter(d => d <= 1).length };
    });
    return json(res, result);
  }

  // ---- STATS: MENSUAL ----
  if (path === '/stats/mensual' && req.method === 'GET') {
    const anio = parseInt(query.anio);
    const mes  = parseInt(query.mes);
    const diasEnMes = new Date(anio, mes, 0).getDate();
    const prefijo = `${anio}-${String(mes).padStart(2,'0')}`;
    const { data: cambios } = await supabase.from('cambios').select('*').like('fecha', `${prefijo}%`).order('fecha');
    const { data: parqs } = await supabase.from('parquimetros').select('id,direccion').order('id');
    const { data: bats } = await supabase.from('baterias').select('id,numero');
    const batMap = {};
    for (const b of (bats || [])) batMap[b.id] = b.numero;
    const parqIds = [...new Set((cambios || []).map(c => c.parquimetro_id))];
    const rows = parqIds.map(pid => {
      const parq = (parqs || []).find(p => p.id === pid);
      const dias = {};
      for (let d = 1; d <= diasEnMes; d++) {
        const fechaStr = `${anio}-${String(mes).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const cc = (cambios || []).filter(c => c.parquimetro_id === pid && c.fecha === fechaStr);
        if (cc.length) dias[d] = cc.map(c => ({ entra: batMap[c.bateria_entra_id] || '?', sale: batMap[c.bateria_sale_id] || '?' }));
      }
      return { id: pid, direccion: parq ? parq.direccion : '?', dias, totalCambios: (cambios || []).filter(c => c.parquimetro_id === pid).length };
    });
    const totalesDia = {};
    for (let d = 1; d <= diasEnMes; d++) {
      const fechaStr = `${anio}-${String(mes).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      totalesDia[d] = (cambios || []).filter(c => c.fecha === fechaStr).length;
    }
    return json(res, { anio, mes, diasEnMes, rows, totalesDia, totalMes: (cambios || []).length });
  }

  return json(res, { error: 'Not found' }, 404);
}
