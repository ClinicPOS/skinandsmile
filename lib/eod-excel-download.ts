import * as XLSX from "xlsx-js-style";

export function encodeEodExcel(workbook: XLSX.WorkBook): Uint8Array<ArrayBuffer> {
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  const sheetIndex = workbook.SheetNames.indexOf("Expenses & Commissions");
  if (sheetIndex < 0) return new Uint8Array(bytes);

  // xlsx-js-style ignores !freeze; patch only the new sheet's view in the saved ZIP.
  const zip = XLSX.CFB.read(new Uint8Array(bytes), { type: "buffer" });
  const path = `/xl/worksheets/sheet${sheetIndex + 1}.xml`;
  const entry = XLSX.CFB.find(zip, path);
  if (!entry) throw new Error("Expenses & Commissions worksheet could not be saved.");
  const xml = new TextDecoder().decode(entry.content);
  const frozenView = '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>';
  if (!xml.includes("<sheetViews>")) throw new Error("Expenses & Commissions header could not be frozen.");
  XLSX.CFB.utils.cfb_add(zip, path.slice(1), new TextEncoder().encode(xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, frozenView)));
  return new Uint8Array(XLSX.CFB.write(zip, { type: "buffer", fileType: "zip" }));
}

export function downloadEodExcel(workbook: XLSX.WorkBook, fileName: string) {
  const url = URL.createObjectURL(new Blob([encodeEodExcel(workbook)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
