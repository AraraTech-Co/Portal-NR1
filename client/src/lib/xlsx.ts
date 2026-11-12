/**
 * Ler e gravar `.xlsx` sem biblioteca. [PF-1]
 *
 * A planilha de funcionários sai do sistema de folha em `.xlsx`, e o RH
 * passa a enviá-la como vem. O `.xlsx` é um zip com XML: o zip se lê pelo
 * diretório central, o conteúdo comprimido se abre com o
 * `DecompressionStream` do próprio navegador, e o XML da planilha é simples
 * o bastante para ler por expressão regular — assim o mesmo código roda no
 * navegador e nos testes do servidor, que não têm `DOMParser`.
 *
 * A biblioteca SheetJS do npm está parada numa versão com falha conhecida, e
 * o exceljs pesa mais do que a tela inteira de importação.
 */

export class PlanilhaIlegivel extends Error {}

const ILEGIVEL = "Não consegui ler este arquivo. Salve como .xlsx sem senha e envie de novo.";

function u16(b: Uint8Array, i: number): number {
  return b[i]! | (b[i + 1]! << 8);
}

function u32(b: Uint8Array, i: number): number {
  return (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;
}

async function inflar(dados: Uint8Array): Promise<Uint8Array> {
  const fluxo = new Blob([dados as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(fluxo).arrayBuffer());
}

/** Os arquivos de dentro do zip, pelo nome. */
async function abrirZip(b: Uint8Array): Promise<Map<string, Uint8Array>> {
  /*
    Arquivo do Office protegido por senha (e o .xls antigo) não é zip: é o
    contêiner OLE, que começa com D0 CF 11 E0.
  */
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) {
    throw new PlanilhaIlegivel(ILEGIVEL);
  }
  let fim = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (u32(b, i) === 0x06054b50) {
      fim = i;
      break;
    }
  }
  if (fim < 0) throw new PlanilhaIlegivel(ILEGIVEL);
  const total = u16(b, fim + 10);
  let p = u32(b, fim + 16);
  const arquivos = new Map<string, Uint8Array>();
  const decoder = new TextDecoder("utf-8");
  for (let n = 0; n < total; n++) {
    if (u32(b, p) !== 0x02014b50) throw new PlanilhaIlegivel(ILEGIVEL);
    const flags = u16(b, p + 8);
    const metodo = u16(b, p + 10);
    const tamanho = u32(b, p + 20);
    const nomeLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const comentarioLen = u16(b, p + 32);
    const local = u32(b, p + 42);
    const nome = decoder.decode(b.subarray(p + 46, p + 46 + nomeLen));
    p += 46 + nomeLen + extraLen + comentarioLen;
    if (flags & 1) throw new PlanilhaIlegivel(ILEGIVEL);
    if (u32(b, local) !== 0x04034b50) throw new PlanilhaIlegivel(ILEGIVEL);
    const inicio = local + 30 + u16(b, local + 26) + u16(b, local + 28);
    const bruto = b.subarray(inicio, inicio + tamanho);
    if (metodo === 0) arquivos.set(nome, bruto);
    else if (metodo === 8) arquivos.set(nome, await inflar(bruto));
    else throw new PlanilhaIlegivel(ILEGIVEL);
  }
  return arquivos;
}

function desescapar(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k === "amp") return "&";
    if (k === "lt") return "<";
    if (k === "gt") return ">";
    if (k === "quot") return '"';
    if (k === "apos") return "'";
    const code = k.startsWith("#x") ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : "";
  });
}

function atributos(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) out[m[1]!] = desescapar(m[2]!);
  return out;
}

/** O texto de um nó com `<t>`, juntando as partes formatadas e sem a leitura fonética. */
function textoDosT(xml: string): string {
  const semFonetica = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of semFonetica.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += desescapar(m[1]!);
  return out;
}

/** "AB12" → 27 (base zero). */
function colunaDe(ref: string): number {
  const letras = /^[A-Z]+/.exec(ref.toUpperCase())?.[0] ?? "";
  let n = 0;
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

function caminhoDaPrimeiraAba(arquivos: Map<string, Uint8Array>, ler: (n: string) => string): string {
  const padrao = "xl/worksheets/sheet1.xml";
  const workbook = arquivos.get("xl/workbook.xml");
  const rels = arquivos.get("xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) return padrao;
  const primeira = /<sheet\b([^>]*)\/?>/.exec(ler("xl/workbook.xml"));
  const rid = primeira ? atributos(primeira[1]!)["r:id"] : undefined;
  if (!rid) return padrao;
  for (const m of ler("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const a = atributos(m[1]!);
    if (a.Id === rid && a.Target) {
      return a.Target.startsWith("/") ? a.Target.slice(1) : `xl/${a.Target.replace(/^\.\//, "")}`;
    }
  }
  return padrao;
}

/**
 * A primeira aba como linhas de texto. Número sai como está no arquivo
 * (data é número de série: quem sabe que a coluna é data converte). Cada
 * linha fica na posição do Excel (a linha 5 é o índice 4), com as linhas em
 * branco como listas vazias.
 */
export async function lerXlsx(bytes: Uint8Array): Promise<string[][]> {
  const arquivos = await abrirZip(bytes);
  const decoder = new TextDecoder("utf-8");
  const ler = (nome: string) => decoder.decode(arquivos.get(nome) ?? new Uint8Array());

  const compartilhados: string[] = [];
  if (arquivos.has("xl/sharedStrings.xml")) {
    for (const m of ler("xl/sharedStrings.xml").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) {
      compartilhados.push(m[1] ? textoDosT(m[1]) : "");
    }
  }

  const aba = caminhoDaPrimeiraAba(arquivos, ler);
  if (!arquivos.has(aba)) throw new PlanilhaIlegivel(ILEGIVEL);
  const xml = ler(aba);

  const linhas: string[][] = [];
  for (const r of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const corpo = r[2] ?? "";
    /* A linha fica no lugar dela, para a prévia citar o número do Excel. */
    const numero = Number(atributos(r[1]!).r);
    if (Number.isInteger(numero) && numero > 0) while (linhas.length < numero - 1) linhas.push([]);
    const linha: string[] = [];
    let proxima = 0;
    for (const c of corpo.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = atributos(c[1]!);
      const coluna = a.r ? colunaDe(a.r) : proxima;
      proxima = coluna + 1;
      const dentro = c[2] ?? "";
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(dentro)?.[1];
      let valor = "";
      if (a.t === "s") valor = v !== undefined ? compartilhados[Number(v)] ?? "" : "";
      else if (a.t === "inlineStr") valor = textoDosT(dentro);
      else if (v !== undefined) valor = desescapar(v);
      while (linha.length < coluna) linha.push("");
      linha[coluna] = valor.trim();
    }
    linhas.push(linha);
  }
  return linhas;
}

/* --- gravar --- */

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function escapar(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function letraDa(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Zip sem compressão: basta para um modelo de poucos KB. */
function zipar(arquivos: [string, string][]): Uint8Array {
  const enc = new TextEncoder();
  const partes: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [nome, conteudo] of arquivos) {
    const n = enc.encode(nome);
    const d = enc.encode(conteudo);
    const crc = crc32(d);
    const local = new Uint8Array(30 + n.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, d.length, true);
    lv.setUint32(22, d.length, true);
    lv.setUint16(26, n.length, true);
    local.set(n, 30);
    const cd = new Uint8Array(46 + n.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, d.length, true);
    cv.setUint32(24, d.length, true);
    cv.setUint16(28, n.length, true);
    cv.setUint32(42, offset, true);
    cd.set(n, 46);
    partes.push(local, d);
    central.push(cd);
    offset += local.length + d.length;
  }
  const tamanhoCentral = central.reduce((t, c) => t + c.length, 0);
  const fim = new Uint8Array(22);
  const fv = new DataView(fim.buffer);
  fv.setUint32(0, 0x06054b50, true);
  fv.setUint16(8, arquivos.length, true);
  fv.setUint16(10, arquivos.length, true);
  fv.setUint32(12, tamanhoCentral, true);
  fv.setUint32(16, offset, true);
  const tudo = [...partes, ...central, fim];
  const out = new Uint8Array(tudo.reduce((t, p) => t + p.length, 0));
  let i = 0;
  for (const p of tudo) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

/**
 * Uma planilha de uma aba, só com texto; a primeira linha sai em negrito e
 * fixa no topo, como cabeçalho.
 */
export function gerarXlsx(linhas: string[][], nomeDaAba = "Planilha"): Uint8Array {
  const corpo = linhas
    .map(
      (linha, r) =>
        `<row r="${r + 1}">${linha
          .map(
            (v, c) =>
              `<c r="${letraDa(c)}${r + 1}" t="inlineStr"${r === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${escapar(v)}</t></is></c>`,
          )
          .join("")}</row>`,
    )
    .join("");
  const colunas = Math.max(1, ...linhas.map((l) => l.length));
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return zipar([
    [
      "[Content_Types].xml",
      `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ],
    [
      "_rels/.rels",
      `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      "xl/workbook.xml",
      `${xml}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapar(nomeDaAba.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ],
    [
      "xl/styles.xml",
      `${xml}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`,
    ],
    [
      "xl/worksheets/sheet1.xml",
      `${xml}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="${colunas}" width="18" customWidth="1"/></cols><sheetData>${corpo}</sheetData></worksheet>`,
    ],
  ]);
}

/** Um `.xlsx` é um zip: começa com "PK\x03\x04". */
export function pareceXlsx(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** Um arquivo do Office protegido por senha, ou o .xls antigo. */
export function pareceOfficeProtegido(bytes: Uint8Array): boolean {
  return bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}
