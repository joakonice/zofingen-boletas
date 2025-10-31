/* Utilidades de formato */
function parseAmountAR(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^\d.,-]/g, "");
  if (!cleaned) return null;
  const normalized = cleaned.replaceAll(".", "").replace(",", ".");
  const num = Number(normalized);
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
    const strings = content.items.map((it) => it.str);
    allText += strings.join(" ") + "\n"; // simple join
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
    "Importe diferencia": "",
    "Diferencia (antes - acreditar)": "",
    "Resta: Importe diferencia - Diferencia (antes - acreditar)": "",
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

  // Importe antes de aranceles e IVA: 1) patrón estricto del script
  let mPre = t.match(/\b[\d\.,]+\s+\d{1,3}%\s+ARS\s+([\d\.,]+)/i);
  if (mPre) {
    const val = parseAmountAR(mPre[1]);
    data["Importe antes de aranceles e IVA"] = formatAmountARPlain(val);
  } else {
    // 2) Fallback sin usar porcentaje: buscar primera aparición de "ARS <monto>"
    // entre "U.de Tasa Importe" (o "Liquidación del día") y "Se acreditará".
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
    data["Importe diferencia"] = formatAmountARPlain(vCheque - vAcred);
  }
  if (vPre != null && vAcred != null) {
    data["Diferencia (antes - acreditar)"] = formatAmountARPlain(vPre - vAcred);
  }
  const vDiffAntes = parseAmountAR(data["Diferencia (antes - acreditar)"]);
  const vDiffImporte = parseAmountAR(data["Importe diferencia"]);
  if (vDiffAntes != null && vDiffImporte != null) {
    data["Resta: Importe diferencia - Diferencia (antes - acreditar)"] = formatAmountARPlain(
      vDiffImporte - vDiffAntes
    );
  }

  return data;
}

/* Orquestador de parsers (extensible a futuro) */
const Parsers = {
  ZOFINGEN: extractZofingen,
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
  "Importe diferencia",
  "Diferencia (antes - acreditar)",
  "Resta: Importe diferencia - Diferencia (antes - acreditar)",
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
  const parser = Parsers[parserKey];
  if (!parser) {
    setStatus(`Parser no disponible: ${parserKey}`);
    return;
  }
  setStatus(`Procesando ${files.length} archivo(s)...`);
  lastRows = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      setStatus(`Leyendo ${file.name} (${i + 1}/${files.length})...`);
      const text = await extractTextFromPDF(file);
      const record = parser(text, file.name);
      // Asegurar código de boleto desde nombre si no aparece en texto
      if (!record["Codigo de boleto"]) {
        const mFile = file.name.match(/print-BOL\s+(\d{10})/i);
        if (mFile) record["Codigo de boleto"] = `BOL ${mFile[1]}`;
      }
      lastRows.push(record);
    } catch (e) {
      lastRows.push({
        "Numero de cheque": "",
        "Vencimiento": "",
        "Importe del cheque": "",
        "Importe antes de aranceles e IVA": "",
        "Codigo de boleto": `(error) ${file.name}`,
        "Fecha de boleto": "",
        "Importe a acreditar": "",
        "Importe diferencia": "",
        "Diferencia (antes - acreditar)": "",
        "Resta: Importe diferencia - Diferencia (antes - acreditar)": "",
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


