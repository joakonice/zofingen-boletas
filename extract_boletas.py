import re
from decimal import Decimal, InvalidOperation
from pathlib import Path

import pdfplumber
import pandas as pd


FOLDER = Path(__file__).parent


def parse_amount_ar(raw_value: str) -> Decimal | None:
    """Parsea importes en formato argentino (miles con '.', decimales con ',').
    Acepta valores con o sin código de moneda.
    """
    if not raw_value:
        return None
    cleaned = re.sub(r"[^\d.,-]", "", raw_value)
    if not cleaned:
        return None
    normalized = cleaned.replace(".", "").replace(",", ".")
    try:
        return Decimal(normalized)
    except InvalidOperation:
        return None


def format_amount_ar(value: Decimal | None) -> str:
    """Formatea Decimal a texto con separadores AR (miles '.', decimales ',')."""
    if value is None:
        return ""
    q = value.quantize(Decimal("0.01"))
    negative = q < 0
    q = -q if negative else q
    entero, dec = f"{q:.2f}".split(".")
    entero_rev = entero[::-1]
    grupos = ".".join([entero_rev[i : i + 3] for i in range(0, len(entero_rev), 3)])[::-1]
    s = f"{grupos},{dec}"
    return f"-{s}" if negative else s


def format_amount_ar_plain(value: Decimal | None) -> str:
    """Formatea Decimal como solo números con coma decimal y sin separador de miles."""
    if value is None:
        return ""
    q = value.quantize(Decimal("0.01"))
    s = f"{q:.2f}"
    if s.startswith("-"):
        return "-" + s[1:].replace(".", ",")
    return s.replace(".", ",")


def read_pdf_text(pdf_path: Path) -> str:
    chunks: list[str] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            chunks.append(text)
    return "\n".join(chunks)


def find_fecha_boleto(text: str) -> str:
    # Preferir etiqueta explícita
    for m in re.finditer(r"Fecha(?:\s+de\s+boleto)?[:\s]+(\d{2}/\d{2}/\d{4})", text, re.IGNORECASE):
        return m.group(1)
    # Fallback: primera 'Fecha:' que no sea parte de Vencimiento
    for m in re.finditer(r"Fecha[:\s]+(\d{2}/\d{2}/\d{4})", text, re.IGNORECASE):
        start = max(0, m.start() - 15)
        context = text[start : m.start()]
        if not re.search(r"Vto\.?\s*$", context, re.IGNORECASE):
            return m.group(1)
    return ""


def extract_from_text(text: str) -> dict[str, str]:
    data: dict[str, str] = {
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
    }

    # Vencimiento (línea completa) y número de ECHEQ
    echeq_line_match = re.search(
        r"(E-?CHEQ\s+\d+[^\n]*?Vto\.?\s+\d{2}/\d{2}/\d{4})",
        text,
        re.IGNORECASE,
    )
    if echeq_line_match:
        echeq_line = echeq_line_match.group(1).strip()
        num_match = re.search(r"(E-?CHEQ)\s+(\d+)", echeq_line, re.IGNORECASE)
        fecha_match = re.search(r"Vto\.?\s+(\d{2}/\d{2}/\d{4})", echeq_line, re.IGNORECASE)
        if num_match:
            data["Numero de cheque"] = f"{num_match.group(1).upper()} {num_match.group(2)}"
        if fecha_match:
            data["Vencimiento"] = fecha_match.group(1)

    # Código de boleto: BOL + 10 dígitos
    bol_match = re.search(r"\bBOL\s+(\d{10})\b", text, re.IGNORECASE)
    if bol_match:
        data["Codigo de boleto"] = f"BOL {bol_match.group(1)}"

    # Fecha de boleto (preferir frases específicas de liquidación o resultado)
    fecha_boleto = None
    m_fb = re.search(r"Liquidaci[oó]n\s+del\s+d[ií]a\s+(\d{2}/\d{2}/\d{4})", text, re.IGNORECASE)
    if not m_fb:
        m_fb = re.search(r"Result\.:\s*Subasta[\s\S]*?(\d{2}/\d{2}/\d{4})", text, re.IGNORECASE)
    fecha_boleto = m_fb.group(1) if m_fb else None
    data["Fecha de boleto"] = fecha_boleto or find_fecha_boleto(text)

    # Importe del cheque (varias alternativas)
    imp_cheque_patterns = [
        # Ej: "Result.: Subasta 100.000.000,00@60%"
        r"Result\.:\s*Subasta\s+([\d\.,]+)@",
        # Ej: en renglón de liquidación: "... 100.000.000 60% ARS 94.559.585,49"
        r"\b([\d\.,]+)\s+60%\s+ARS\s+[\d\.,]+",
        # Otras posibles etiquetas
        r"Importe\s+del\s+(?:e-?cheque|cheque)[:\s]*([A-Z]{3}\s*)?([\d\.,]+)",
        r"Monto\s+del\s+cheque[:\s]*([A-Z]{3}\s*)?([\d\.,]+)",
        r"Importe\s+ECHEQ[:\s]*([A-Z]{3}\s*)?([\d\.,]+)",
    ]
    imp_cheque_raw = None
    for pat in imp_cheque_patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            # Algunos patrones sólo tienen un grupo; otros tienen dos (moneda + monto)
            if m.lastindex and m.lastindex >= 2 and m.group(2):
                imp_cheque_raw = (m.group(1) or "") + m.group(2)
            else:
                imp_cheque_raw = m.group(1)
            break

    if imp_cheque_raw:
        val = parse_amount_ar(imp_cheque_raw)
        data["Importe del cheque"] = (
            format_amount_ar_plain(val) if val is not None else imp_cheque_raw.strip()
        )

    # Importe a acreditar
    # Importe a acreditar: "Se acreditará la cantidad de ARS 94.300.833,38"
    imp_acred_match = re.search(
        r"Se\s+acreditar[áa][\s\S]*?ARS\s+([\d\.,]+)",
        text,
        re.IGNORECASE,
    )
    if imp_acred_match:
        imp_acred_raw = imp_acred_match.group(1)
        val = parse_amount_ar(imp_acred_raw)
        data["Importe a acreditar"] = (
            format_amount_ar_plain(val) if val is not None else imp_acred_raw.strip()
        )

    # Importe antes de aranceles e IVA: tomar el ARS del renglón de liquidación (después del %)
    # Ejemplo: "... 100.000.000 60% ARS 94.559.585,49 A"
    pre_fees_match = re.search(
        r"\b[\d\.,]+\s+\d{1,3}%\s+ARS\s+([\d\.,]+)",
        text,
        re.IGNORECASE,
    )
    if pre_fees_match:
        pre_raw = pre_fees_match.group(1)
        val = parse_amount_ar(pre_raw)
        data["Importe antes de aranceles e IVA"] = (
            format_amount_ar_plain(val) if val is not None else pre_raw.strip()
        )

    # Cálculos
    v_cheque = parse_amount_ar(data["Importe del cheque"])
    v_acred = parse_amount_ar(data["Importe a acreditar"])
    if v_cheque is not None and v_acred is not None:
        data["TOTAL CARGA"] = format_amount_ar_plain(v_cheque - v_acred)

    # Diferencia (antes - acreditar)
    v_pre = parse_amount_ar(data["Importe antes de aranceles e IVA"])
    if v_pre is not None and v_acred is not None:
        data["IVA"] = format_amount_ar_plain(v_pre - v_acred)

    # SIN IVA = TOTAL CARGA - IVA (o cheque - antes)
    v_total = parse_amount_ar(data.get("TOTAL CARGA", ""))
    v_iva = parse_amount_ar(data.get("IVA", ""))
    if v_total is not None and v_iva is not None:
        data["SIN IVA"] = format_amount_ar_plain(v_total - v_iva)
    elif v_cheque is not None and v_pre is not None:
        data["SIN IVA"] = format_amount_ar_plain(v_cheque - v_pre)

    return data


def main() -> None:
    pdf_files = []
    pdf_files.extend(FOLDER.glob("print-BOL *.pdf"))
    input_dir = FOLDER / "input-examples"
    if input_dir.exists():
        pdf_files.extend(input_dir.glob("print-BOL *.pdf"))
    pdf_files = sorted(pdf_files)
    rows: list[dict[str, str]] = []
    for pdf_path in pdf_files:
        try:
            text = read_pdf_text(pdf_path)
            record = extract_from_text(text)
            # Respaldo de código de boleto desde el nombre del archivo si falta
            if not record["Codigo de boleto"]:
                m = re.search(r"print-BOL\s+(\d{10})", pdf_path.name, re.IGNORECASE)
                if m:
                    record["Codigo de boleto"] = f"BOL {m.group(1)}"
            rows.append(record)
        except Exception:
            rows.append(
                {
                    "Numero de cheque": "",
                    "Vencimiento": "",
                    "Importe del cheque": "",
                    "Codigo de boleto": f"(error) {pdf_path.name}",
                    "Fecha de boleto": "",
                    "Importe a acreditar": "",
                    "Importe diferencia": "",
                }
            )

    df = pd.DataFrame(
        rows,
        columns=[
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
        ],
    )

    # Guardar CSV (separador ;) y Excel
    df.to_csv(FOLDER / "boletas.csv", sep=";", index=False, encoding="utf-8-sig", lineterminator="\n")
    try:
        df.to_excel(FOLDER / "boletas.xlsx", index=False)
    except PermissionError:
        # Si el archivo está abierto, guardar con otro nombre
        df.to_excel(FOLDER / "boletas_out.xlsx", index=False)


if __name__ == "__main__":
    main()


