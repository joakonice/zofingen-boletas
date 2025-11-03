/* Utilidades de formato */
function parseAmountAR(raw) {
  if (!raw) return null;
  const s = String(raw).replace(/[^\d\.,-]/g, "");
  if (!s) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let norm;
  if (lastDot !== -1 && lastComma !== -1) {
    // Ambos presentes: decidir por posición
    if (lastDot > lastComma) {
      // US style: commas thousands, dot decimal
      norm = s.replace(/,/g, "");
    } else {
      // AR style
      norm = s.replace(/\./g, "").replace(/,/g, ".");
    }
  } else if (lastComma !== -1 && lastDot === -1) {
    // Solo coma: usar como decimal
    norm = s.replace(/\./g, "").replace(/,/g, ".");
  } else if (lastDot !== -1 && lastComma === -1) {
    // Solo punto: si hay 2-4 dígitos a la derecha, tratar como decimal
    const right = s.length - lastDot - 1;
    if (right >= 2 && right <= 4) {
      norm = s.replace(/,/g, "");
    } else {
      // improbable, pero tratar punto como miles
      norm = s.replace(/\./g, "");
    }
  } else {
    norm = s;
  }
  const num = Number(norm);
  return Number.isFinite(num) ? num : null;
}

function formatAmountARPlain(num) {
  if (num == null || !Number.isFinite(num)) return "";
  // 2 decimales, coma decimal, sin separador de miles
  const fixed = num.toFixed(2);
  if (fixed.startsWith("-")) return "-" + fixed.slice(1).replace(".", ",");
  return fixed.replace(".", ",");
}

/* Extracción de texto con PDF.js */
async function extractTextFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  let allText = "";
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    let pageText = "";
    for (const it of content.items) {
      const s = it.str || "";
      pageText += s;
      // cortar línea cuando el motor lo indica (mejor para patrones basados en filas)
      pageText += it.hasEOL ? "\n" : " ";
    }
    allText += pageText + "\n";
  }
  return allText;
}

/* Parser ZOFINGEN */
function extractZofingen(text, fileName) {
  // Normalizar espacios no separables y variantes
  const t = text.replace(/\u00A0/g, " ");
  const data = {
    "Numero de cheque": "",
    "Vencimiento": "",
    "Importe del cheque": "",
    "Importe antes de aranceles e IVA": "",
    "Codigo de boleto": "",
    "Fecha de boleto": "",
    "Importe a acreditar": "",
    "TOTAL CARGA": "",
    "IVA": "",
    "SIN IVA": "",
    "ARANCELES CON IVA": "",
    "IVA ARANCELES": "",
    "ARANCELES SIN IVA": "",
  };

  // Codigo de boleto
  const bolMatch = t.match(/\bBOL\s+(\d{10})\b/i);
  if (bolMatch) data["Codigo de boleto"] = `BOL ${bolMatch[1]}`;
  // Fallback desde nombre de archivo
  if (!data["Codigo de boleto"]) {
    const mFile = fileName.match(/print-BOL\s+(\d{10})/i);
    if (mFile) data["Codigo de boleto"] = `BOL ${mFile[1]}`;
  }

  // Vencimiento y Numero de cheque
  const echeqLine = t.match(/(E-?CHEQ\s+\d+[^\n]*?Vto\.?\s+\d{2}\/\d{2}\/\d{4})/i);
  if (echeqLine) {
    const line = echeqLine[1];
    const mNum = line.match(/(E-?CHEQ)\s+(\d+)/i);
    const mVto = line.match(/Vto\.?\s+(\d{2}\/\d{2}\/\d{4})/i);
    if (mNum) data["Numero de cheque"] = `${mNum[1].toUpperCase()} ${mNum[2]}`;
    if (mVto) data["Vencimiento"] = mVto[1];
  }

  // Fecha de boleto
  let fechaBoleto = null;
  let mFb = t.match(/Liquidaci[oó]n\s+del\s+d[ií]a\s+(\d{2}\/\d{2}\/\d{4})/i);
  if (!mFb) mFb = t.match(/Result\.:\s*Subasta[\s\S]*?(\d{2}\/\d{2}\/\d{4})/i);
  fechaBoleto = mFb ? mFb[1] : null;
  data["Fecha de boleto"] = fechaBoleto || "";

  // Importe del cheque
  const chequePatterns = [
    /Result\.:\s*Subasta\s+([\d\.,]+)@/i,
    /\b([\d\.,]+)\s+60%\s+ARS\s+[\d\.,]+/i,
    /Importe\s+del\s+(?:e-?cheque|cheque)[:\s]*([A-Z]{3}\s*)?([\d\.,]+)/i,
    /Monto\s+del\s+cheque[:\s]*([A-Z]{3}\s*)?([\d\.,]+)/i,
    /Importe\s+ECHEQ[:\s]*([A-Z]{3}\s*)?([\d\.,]+)/i,
  ];
  let chequeRaw = null;
  for (const pat of chequePatterns) {
    const m = t.match(pat);
    if (m) {
      chequeRaw = m[2] ? `${m[1] || ""}${m[2]}` : m[1];
      break;
    }
  }
  if (chequeRaw) {
    const val = parseAmountAR(chequeRaw);
    data["Importe del cheque"] = formatAmountARPlain(val);
  }

  // Importe a acreditar: "Se acreditará la cantidad de ARS 94.300.833,38"
  const mAcred = t.match(/Se\s+acreditar[áa][\s\S]*?ARS\s+([\d\.,]+)/i);
  if (mAcred) {
    const val = parseAmountAR(mAcred[1]);
    data["Importe a acreditar"] = formatAmountARPlain(val);
  }

  // Importe antes de aranceles e IVA (igual que script)
  let mPre = t.match(/\b[\d\.,]+\s+\d{1,3}%\s+ARS\s+([\d\.,]+)/i);
  if (mPre) {
    const val = parseAmountAR(mPre[1]);
    data["Importe antes de aranceles e IVA"] = formatAmountARPlain(val);
  } else {
    let startIdx = t.search(/U\.?\s*de\s*Tasa\s*Importe/i);
    if (startIdx < 0) startIdx = t.search(/Liquidaci[oó]n\s+del\s+d[ií]a/i);
    const endIdx = (() => {
      const i = t.search(/Se\s+acreditar[áa]/i);
      return i > 0 ? i : t.length;
    })();
    const scope = startIdx >= 0 ? t.slice(startIdx, endIdx) : t.slice(0, endIdx);
    const mArs = scope.match(/ARS\s+([\d\.,]+)/i);
    if (mArs) {
      const val = parseAmountAR(mArs[1]);
      data["Importe antes de aranceles e IVA"] = formatAmountARPlain(val);
    }
  }

  // Cálculos
  const vCheque = parseAmountAR(data["Importe del cheque"]);
  const vAcred = parseAmountAR(data["Importe a acreditar"]);
  const vPre = parseAmountAR(data["Importe antes de aranceles e IVA"]);
  if (vCheque != null && vAcred != null) {
    data["TOTAL CARGA"] = formatAmountARPlain(vCheque - vAcred);
  }
  const vTotal = parseAmountAR(data["TOTAL CARGA"]);
  if (vTotal != null) {
    const sinIva = vTotal / 1.21;
    data["SIN IVA"] = formatAmountARPlain(sinIva);
    data["IVA"] = formatAmountARPlain(vTotal - sinIva);
  }

  if (vPre != null && vAcred != null) {
    const arCon = vPre - vAcred;
    data["ARANCELES CON IVA"] = formatAmountARPlain(arCon);
    const ivaAr = arCon / 1.21;
    data["IVA ARANCELES"] = formatAmountARPlain(ivaAr);
    data["ARANCELES SIN IVA"] = formatAmountARPlain(arCon - ivaAr);
  }

  return data;
}

/* Parser ALLARIA (multi-cheque, prorrateo de cargos) */
function extractAllaria(text, fileName) {
  const t = text.replace(/\u00A0/g, " ");
  const blockMatch = t.match(/Monto\s+Precio\s+Importe\s+Bruto([\s\S]*?)IMPORTE\s+NETO/i);
  const block = blockMatch ? blockMatch[1] : t;

  // Construcción robusta de ítems por líneas (tolerante a saltos y códigos 3 dígitos)
  const items = [];
  let lastMonto = null;
  const lines = block.split(/\n+/);
  const montoRe = /\b\d{1,3}(?:[\.,]\d{3})+[\.,]\d{4}\b/;
  const precioBrutoCodRe = /\b([\d\.,]+)\s+([\d\.,]+)\s+\d{3}\b/;
  for (const ln of lines) {
    const l = ln.trim();
    if (!l) continue;
    const mm = l.match(montoRe);
    if (mm) {
      const v = parseAmountAR(mm[0]);
      if (v != null) lastMonto = v;
      continue;
    }
    const pb = l.match(precioBrutoCodRe);
    if (pb) {
      const precio = parseAmountAR(pb[1]);
      const bruto = parseAmountAR(pb[2]);
      items.push({ monto: lastMonto, bruto, precio });
      lastMonto = null;
    }
  }
  // Fallback adicional: pares sueltos (precio bruto codigo) si nada entró
  if (!items.length) {
    const pairs = [...block.matchAll(/\b([\d\.,]+)\s+([\d\.,]+)\s+\d{3}\b/g)];
    for (const p of pairs) {
      const precio = parseAmountAR(p[1]);
      const bruto = parseAmountAR(p[2]);
      items.push({ monto: null, bruto, precio });
    }
  }

  // Completar montos faltantes (Importe del cheque)
  if (items.length) {
    const needMontoIdx = items.map((it, i) => (it.monto == null ? i : -1)).filter((i) => i >= 0);
    if (needMontoIdx.length) {
      // 1) intentamos con todos los montos de 4 decimales del bloque
      const allMontos = (block.match(/\b\d{1,3}(?:[\.,]\d{3})+[\.,]\d{4}\b/g) || []).map(parseAmountAR).filter((v) => v != null);
      if (allMontos.length === items.length) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].monto == null) items[i].monto = allMontos[i];
        }
      } else if (items.length === 1) {
        // 2) si hay un único ítem y existe un sólo monto de 4 decimales, usarlo
        if (allMontos.length === 1) items[0].monto = allMontos[0];
        // 3) fallback V/N- para nominal único
        if (items[0].monto == null) {
          const mVN = t.match(/V\/?N-\s*([\d\.,]+)/i);
          if (mVN) items[0].monto = parseAmountAR(mVN[1]);
        }
      } else {
        // 4) calcular monto a partir de precio y bruto: monto ≈ bruto / (precio/100)
        for (const idx of needMontoIdx) {
          const it = items[idx];
          if (it.monto == null && it.bruto != null && it.precio != null && it.precio > 0) {
            const montoCalc = it.bruto / (it.precio / 100);
            if (Number.isFinite(montoCalc)) {
              it.monto = Math.round(montoCalc * 10000) / 10000; // mantener 4 decimales como en el PDF
            }
          }
        }
      }
    }
  }

  // Cheques dentro del bloque
  const chq = [...block.matchAll(/CHEQUE\s+(\d{4,8})\s+(\d{2}\/\d{2}\/\d{2,4})/gi)].map((x) => {
    const num = x[1];
    let vto = x[2];
    const yy = vto.split("/").pop();
    if (yy && yy.length === 2) {
      const [dd, mm] = vto.split("/");
      vto = `${dd}/${mm}/20${yy}`;
    }
    return { num, vto };
  });

  // cargos totales
  const mAr = block.match(/Arancel\s+[^\n]*?\s([\d\.,]+)/i);
  const mDm = block.match(/D\.?Mercado\s+[^\n]*?\s([\d\.,]+)/i);
  const mIva = block.match(/IVA\s+s\/\s+[^\n]*?\s21\.?0*%\s+([\d\.,]+)/i);
  const arTotal = parseAmountAR(mAr && mAr[1]) || 0;
  const dmTotal = parseAmountAR(mDm && mDm[1]) || 0;
  const ivaTotal = parseAmountAR(mIva && mIva[1]) || 0;

  // header
  let code = null, fechaBoleto = "";
  const hdr = t.match(/\b(\d+)\s+(\d{2}\/\d{2}\/\d{2})\s+(\d{2}\/\d{2}\/\d{2})\s+(\d+)\b/);
  if (hdr) {
    code = hdr[4];
    const [dd, mm, yy] = hdr[3].split("/");
    fechaBoleto = `${dd}/${mm}/20${yy}`;
  }

  const sumBrutos = items.reduce((a, it) => a + (it.bruto || 0), 0);
  const rows = [];
  let accA = 0, accM = 0, accV = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const factor = sumBrutos ? it.bruto / sumBrutos : 0;
    let a_i = +(arTotal * factor).toFixed(2);
    let m_i = +(dmTotal * factor).toFixed(2);
    let v_i = +(ivaTotal * factor).toFixed(2);
    if (i === items.length - 1) {
      a_i = +(arTotal - accA).toFixed(2);
      m_i = +(dmTotal - accM).toFixed(2);
      v_i = +(ivaTotal - accV).toFixed(2);
    }
    accA = +(accA + a_i).toFixed(2);
    accM = +(accM + m_i).toFixed(2);
    accV = +(accV + v_i).toFixed(2);

    const impAcred = (it.bruto || 0) - (a_i + m_i + v_i);
    const cheque = (it.monto != null ? it.monto : null);
    const totalCarga = cheque != null ? cheque - impAcred : null;
    const sinIva = totalCarga != null ? totalCarga / 1.21 : null;
    const ivaTc = totalCarga != null ? totalCarga - sinIva : null;

    const num = chq[i] && chq[i].num ? chq[i].num : "";
    const vto = chq[i] && chq[i].vto ? chq[i].vto : "";

    rows.push({
      "Numero de cheque": num ? `ECHEQ ${num}` : "",
      "Vencimiento": vto,
      "Importe del cheque": formatAmountARPlain(cheque),
      "Importe antes de aranceles e IVA": formatAmountARPlain(it.bruto),
      "Codigo de boleto": code || `ALLARIA ${fileName}`,
      "Fecha de boleto": fechaBoleto,
      "Importe a acreditar": formatAmountARPlain(impAcred),
      "TOTAL CARGA": formatAmountARPlain(totalCarga),
      "IVA": formatAmountARPlain(ivaTc),
      "SIN IVA": formatAmountARPlain(sinIva),
      "ARANCELES CON IVA": formatAmountARPlain(a_i + m_i + v_i),
      "IVA ARANCELES": formatAmountARPlain((a_i + m_i + v_i) / 1.21),
      "ARANCELES SIN IVA": formatAmountARPlain((a_i + m_i + v_i) - ((a_i + m_i + v_i) / 1.21)),
    });
  }
  return rows.length ? rows : [{
    "Numero de cheque": "",
    "Vencimiento": "",
    "Importe del cheque": "",
    "Importe antes de aranceles e IVA": "",
    "Codigo de boleto": code || `ALLARIA ${fileName}`,
    "Fecha de boleto": fechaBoleto,
    "Importe a acreditar": "",
    "TOTAL CARGA": "",
    "IVA": "",
    "SIN IVA": "",
    "ARANCELES CON IVA": "",
    "IVA ARANCELES": "",
    "ARANCELES SIN IVA": "",
  }];
}

/* Orquestador de parsers (extensible a futuro) */
const Parsers = {
  AUTO: null, // se resuelve en runtime
  ZOFINGEN: extractZofingen,
  ALLARIA: extractAllaria,
};

/* Exportar CSV y XLSX */
function toCSV(rows, columns) {
  const sep = ";";
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    if (s.includes("\n") || s.includes("\"") || s.includes(sep)) {
      return '"' + s.replaceAll('"', '""') + '"';
    }
    return s;
  };
  const header = columns.join(sep);
  const lines = rows.map((r) => columns.map((c) => esc(r[c])).join(sep));
  return [header, ...lines].join("\n");
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toXLSXAndDownload(rows, columns, filename) {
  const data = [columns, ...rows.map((r) => columns.map((c) => r[c] ?? ""))];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Boletas");
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  downloadBlob(wbout, filename, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

/* UI logic */
const statusArea = document.getElementById("statusArea");
const summaryArea = document.getElementById("summaryArea");
const processBtn = document.getElementById("processBtn");
const downloadCsvBtn = document.getElementById("downloadCsvBtn");
const downloadXlsxBtn = document.getElementById("downloadXlsxBtn");
const inputEl = document.getElementById("pdfFiles");
const parserSelect = document.getElementById("parserSelect");

let lastRows = [];
const columns = [
  "Numero de cheque",
  "Vencimiento",
  "Importe del cheque",
  "Importe antes de aranceles e IVA",
  "Codigo de boleto",
  "Fecha de boleto",
  "Importe a acreditar",
  "TOTAL CARGA",
  "IVA",
  "SIN IVA",
  "ARANCELES CON IVA",
  "IVA ARANCELES",
  "ARANCELES SIN IVA",
];

function setStatus(msg) {
  statusArea.textContent = msg;
}

processBtn.addEventListener("click", async () => {
  const files = Array.from(inputEl.files || []);
  if (!files.length) {
    setStatus("Primero seleccioná uno o más PDFs.");
    return;
  }
  const parserKey = parserSelect.value;
  setStatus(`Procesando ${files.length} archivo(s)...`);
  lastRows = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      setStatus(`Leyendo ${file.name} (${i + 1}/${files.length})...`);
      const text = await extractTextFromPDF(file);
      let parser = Parsers[parserKey];
      if (!parser || parserKey === "AUTO") {
        if (/ALLARIA\s+AGROFINANZAS/i.test(text) || /Monto\s+Precio\s+Importe\s+Bruto/i.test(text)) parser = extractAllaria;
        else parser = extractZofingen;
      }
      const result = parser(text, file.name);
      const pushWithCode = (rec) => {
        if (!rec["Codigo de boleto"]) {
          const mFile = file.name.match(/print-BOL\s+(\d{10})/i);
          if (mFile) rec["Codigo de boleto"] = `BOL ${mFile[1]}`;
        }
        lastRows.push(rec);
      };
      if (Array.isArray(result)) result.forEach(pushWithCode);
      else pushWithCode(result);
    } catch (e) {
      lastRows.push({
        "Numero de cheque": "",
        "Vencimiento": "",
        "Importe del cheque": "",
        "Importe antes de aranceles e IVA": "",
        "Codigo de boleto": `(error) ${file.name}`,
        "Fecha de boleto": "",
        "Importe a acreditar": "",
        "TOTAL CARGA": "",
        "IVA": "",
        "SIN IVA": "",
        "ARANCELES CON IVA": "",
        "IVA ARANCELES": "",
        "ARANCELES SIN IVA": "",
      });
    }
  }

  setStatus(`Listo. Procesados ${lastRows.length} archivo(s).`);
  summaryArea.textContent = `Columnas: ${columns.join(" | ")}`;
  downloadCsvBtn.disabled = false;
  downloadXlsxBtn.disabled = false;
});

downloadCsvBtn.addEventListener("click", () => {
  if (!lastRows.length) return;
  const csv = toCSV(lastRows, columns);
  downloadBlob(csv, "boletas.csv", "text/csv;charset=utf-8");
});

downloadXlsxBtn.addEventListener("click", () => {
  if (!lastRows.length) return;
  toXLSXAndDownload(lastRows, columns, "boletas.xlsx");
});


