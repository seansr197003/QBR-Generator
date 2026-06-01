const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        AlignmentType, BorderStyle, WidthType, ShadingType, ImageRun } = require('docx');

exports.handler = async function(event) {

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: { message: 'API key not configured.' } }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: { message: 'Invalid request' } }) }; }

  try {
    // 1. Call Claude API
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        system: body.system,
        messages: body.messages,
      }),
    });

    if (!aiRes.ok) {
      const err = await aiRes.json().catch(() => ({ error: { message: aiRes.statusText } }));
      return { statusCode: aiRes.status, headers: cors, body: JSON.stringify(err) };
    }

    const aiData = await aiRes.json();
    const txt = aiData.content.map(c => c.text || '').join('');
    const clean = txt.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const ai = JSON.parse(clean);

    // 2. Build docx on server
    const d = body.formData;
    const docxBuf = await buildDocx(d, ai);

    // 3. Return base64 encoded docx
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        docx: docxBuf.toString('base64'),
        filename: (d.orgName || 'QBR') + '_QBR_' + (d.meetingDate || new Date().toISOString().split('T')[0]) + '.docx'
      }),
    };

  } catch(err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: { message: err.message } }) };
  }
};

async function buildDocx(d, ai) {
  const G='1C4E4F', MT='D7E7E1', CE='B6D2AD', CA='101418', GUN='142828', SS='F6FAF9';
  const bd = { style: BorderStyle.SINGLE, size: 1, color: CE };
  const bds = { top: bd, bottom: bd, left: bd, right: bd };

  function h1(text) {
    return new Paragraph({ children: [new TextRun({ text, font: 'Calibri', size: 30, color: G })],
      spacing: { before: 280, after: 100 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 5, color: CE, space: 4 } } });
  }
  function h2(text) {
    return new Paragraph({ children: [new TextRun({ text, font: 'Calibri', size: 24, color: G })], spacing: { before: 160, after: 60 } });
  }
  function p(text, col) {
    return new Paragraph({ children: [new TextRun({ text: String(text || ''), font: 'Calibri', size: 22, color: col || CA })], spacing: { after: 100 } });
  }
  function sp() { return new Paragraph({ children: [new TextRun({ text: '', size: 20 })], spacing: { after: 80 } }); }
  function hc(text, w) {
    return new TableCell({ borders: bds, width: { size: w, type: WidthType.DXA },
      shading: { fill: MT, type: ShadingType.CLEAR }, margins: { top: 70, bottom: 70, left: 100, right: 100 },
      children: [new Paragraph({ children: [new TextRun({ text, font: 'Calibri', size: 18, color: GUN })] })] });
  }
  function dc(text, w) {
    return new TableCell({ borders: bds, width: { size: w, type: WidthType.DXA },
      margins: { top: 70, bottom: 70, left: 100, right: 100 },
      children: [new Paragraph({ children: [new TextRun({ text: String(text || ''), font: 'Calibri', size: 20, color: CA })] })] });
  }
  function row(cells) { return new TableRow({ children: cells }); }
  function tbl(total, cols, rows) { return new Table({ width: { size: total, type: WidthType.DXA }, columnWidths: cols, rows }); }
  function fDate(dt) {
    if (!dt) return '—';
    const parts = dt.split('-');
    if (parts.length < 3) return dt;
    const ms = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return parts[2] + ' ' + ms[parseInt(parts[1])-1] + ' ' + parts[0];
  }

  const kids = [];

  kids.push(new Paragraph({ children: [new TextRun({ text: 'Quarterly Business Review', font: 'Calibri', size: 36, color: G })], alignment: AlignmentType.CENTER, spacing: { before: 160, after: 80 } }));
  kids.push(new Paragraph({ children: [new TextRun({ text: d.orgName || '', font: 'Calibri', size: 52, color: GUN })], alignment: AlignmentType.CENTER, spacing: { after: 240 } }));

  kids.push(tbl(9360, [3120,3120,3120], [
    row([
      new TableCell({ borders: bds, width: { size: 3120, type: WidthType.DXA }, shading: { fill: MT, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 110, right: 110 }, children: [p('Date & Time', GUN), p(fDate(d.meetingDate) + ' at ' + d.meetingTime, G)] }),
      new TableCell({ borders: bds, width: { size: 3120, type: WidthType.DXA }, shading: { fill: MT, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 110, right: 110 }, children: [p('Location', GUN), p(d.location, G)] }),
      new TableCell({ borders: bds, width: { size: 3120, type: WidthType.DXA }, shading: { fill: MT, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 110, right: 110 }, children: [p('MCR Attendees', GUN), p((d.mcrAtts || []).join(', ') || '—', G)] }),
    ]),
    row([
      new TableCell({ borders: bds, width: { size: 3120, type: WidthType.DXA }, shading: { fill: SS, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 110, right: 110 }, children: [p('Client Attendees', GUN), p((d.clientAtts || []).join(', ') || '—', G)] }),
      new TableCell({ borders: bds, width: { size: 3120, type: WidthType.DXA }, shading: { fill: SS, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 110, right: 110 }, children: [p('Apologies', GUN), p((d.apologies || []).join(', ') || 'None', G)] }),
      new TableCell({ borders: bds, width: { size: 3120, type: WidthType.DXA }, shading: { fill: SS, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 110, right: 110 }, children: [p('Survey Status', GUN), p(d.surveyStatus, G)] }),
    ])
  ]));
  kids.push(sp());

  if (ai.keyUpdates && ai.keyUpdates.length) {
    kids.push(h1('Key Updates Since Last Meeting'));
    kids.push(tbl(9360, [3000,4000,2360], [row([hc('Topic',3000),hc('Update',4000),hc('Notes',2360)])].concat(ai.keyUpdates.map(u => row([dc(u.topic,3000),dc(u.update,4000),dc(u.notes,2360)])))));
    kids.push(sp());
  }
  if (ai.pointsRaised && ai.pointsRaised.length) {
    kids.push(h1('Points Raised'));
    ai.pointsRaised.forEach(pt => { kids.push(h2(pt.heading)); kids.push(p(pt.narrative)); });
    kids.push(sp());
  }
  if (ai.strategicDiscussions && ai.strategicDiscussions.length) {
    kids.push(h1('Strategic Discussions'));
    ai.strategicDiscussions.forEach(s => kids.push(new Paragraph({ children: [new TextRun({ text: '• ' + s, font: 'Calibri', size: 22, color: CA })], spacing: { after: 80 }, indent: { left: 360 } })));
    kids.push(sp());
  }
  if (ai.supportPoints && ai.supportPoints.length) {
    kids.push(h1('Support Overview'));
    ai.supportPoints.forEach(s => kids.push(new Paragraph({ children: [new TextRun({ text: '• ' + s, font: 'Calibri', size: 22, color: CA })], spacing: { after: 80 }, indent: { left: 360 } })));
    kids.push(sp());
  }

  kids.push(h1('KPI Dashboards'));
  kids.push(p('See attached dashboard screenshots.'));
  kids.push(sp());

  kids.push(h1('Survey & KPI Status'));
  kids.push(p('Status: ' + d.surveyStatus));
  if (d.surveyNotes) kids.push(p('Notes: ' + d.surveyNotes));
  kids.push(sp());

  kids.push(h1('Upcoming Dates'));
  const validDates = (d.dates || []).filter(dt => dt.event || dt.date);
  if (validDates.length) {
    kids.push(tbl(9360, [2000,1800,1500,4060], [row([hc('Event',2000),hc('Date',1800),hc('Time',1500),hc('Notes',4060)])].concat(validDates.map(dt => row([dc(dt.event,2000),dc(fDate(dt.date),1800),dc(dt.time,1500),dc(dt.notes,4060)])))));
  } else { kids.push(p('No upcoming dates recorded.')); }
  kids.push(sp());

  kids.push(h1('Outstanding & New Quotes'));
  const vq = (d.quotes || []).filter(q => q.qn || q.desc);
  if (vq.length) {
    kids.push(tbl(9360, [2000,3560,1300,2500], [row([hc('Quote No.',2000),hc('Description',3560),hc('Value',1300),hc('Status',2500)])].concat(vq.map(q => row([dc(q.qn,2000),dc(q.desc,3560),dc('£'+q.val,1300),dc(q.status,2500)])))));
  } else { kids.push(p('No Outstanding Quotes.')); }
  kids.push(sp());

  if (ai.actionItems && ai.actionItems.length) {
    kids.push(h1('Action Items'));
    kids.push(tbl(9360, [3560,2000,1800,2000], [row([hc('Action',3560),hc('Owner',2000),hc('Deadline',1800),hc('Status',2000)])].concat(ai.actionItems.map(a => row([dc(a.task,3560),dc(a.owner,2000),dc(a.deadline,1800),dc(a.status,2000)])))));
    kids.push(sp());
  }

  kids.push(h1('Contract Information'));
  kids.push(tbl(9360, [2340,2340,2340,2340], [
    row([hc('Renewal Date',2340),hc('Contract End',2340),hc('Windows Expiry',2340),hc('Till Version',2340)]),
    row([dc(d.renewalDate||'—',2340),dc(d.contractEnd||'—',2340),dc(d.winExpiry||'—',2340),dc(d.tillVer||'—',2340)])
  ]));
  kids.push(sp());

  if (d.extraNotes) { kids.push(h1('Additional Notes')); kids.push(p(d.extraNotes)); kids.push(sp()); }

  kids.push(new Paragraph({ children: [new TextRun({ text: 'Confidential — MCR Systems © ' + new Date().getFullYear(), font: 'Calibri', size: 18, color: GUN })], alignment: AlignmentType.CENTER, spacing: { before: 300 } }));

  const doc = new Document({
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1296, bottom: 1440, left: 1296 } } }, children: kids }]
  });

  return await Packer.toBuffer(doc);
}
