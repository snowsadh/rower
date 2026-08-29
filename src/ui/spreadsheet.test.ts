import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { exportSpreadsheet, parseSpreadsheet } from "./spreadsheet";

describe("spreadsheet import and export", () => {
  it("never loses values when repeated headers collide with an existing suffix", async () => {
    const parsed = await parseSpreadsheet(new File(["name,name,name_2\nfirst,second,third"], "duplicates.csv"));
    expect(Object.values(parsed.rows[0])).toEqual(["first", "second", "third"]);
    expect(new Set(parsed.headers).size).toBe(3);
  });
  it("reads 150,000 CSV rows without exceeding JavaScript argument limits", async () => {
    const parsed = await parseSpreadsheet(new File(["company\n" + "Acme\n".repeat(150000)], "large.csv"));
    expect(parsed.rows).toHaveLength(150000);
    expect(parsed.headers).toEqual(["company"]);
  });
  it("keeps generated values on their physical Excel rows when blank rows exist", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Data");
    worksheet.getRow(1).values = ["company", "location"];
    worksheet.getRow(2).values = ["Acme", "Pune"];
    worksheet.getRow(4).values = ["Globex", "Mumbai"];
    const input = new Uint8Array(await workbook.xlsx.writeBuffer());
    const file = new File([input], "companies.xlsx");

    const parsed = await parseSpreadsheet(file);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.sourceRowNumbers).toEqual([2, 4]);

    const exported = await exportSpreadsheet(parsed, ["official_website"], new Map([
      ["row-1", { official_website: "https://acme.test" }],
      ["row-2", { official_website: "=unsafe" }]
    ]));
    const resultBook = new ExcelJS.Workbook();
    await resultBook.xlsx.load(await exported.blob.arrayBuffer());
    const resultSheet = resultBook.getWorksheet("Data")!;
    expect(resultSheet.getCell(2, 3).value).toBe("https://acme.test");
    expect(resultSheet.getCell(3, 3).value).toBeNull();
    expect(resultSheet.getCell(4, 3).value).toBe("'=unsafe");
  });

  it("preserves duplicate headers with stable unique names in CSV", async () => {
    const file = new File(["title,title\nEngineer,Developer\n"], "titles.csv", { type: "text/csv" });
    const parsed = await parseSpreadsheet(file);
    expect(parsed.headers).toEqual(["title", "title_2"]);
    expect(parsed.rows[0]).toEqual({ title: "Engineer", title_2: "Developer" });

    const exported = await exportSpreadsheet(parsed, ["same"], new Map([["row-1", { same: true }]]));
    expect(await exported.blob.text()).toBe("title,title,same\r\nEngineer,Developer,true\r\n,,");
  });

  it("uses the first non-empty row as the header and preserves blank CSV rows", async () => {
    const file = new File(["\ncompany,country\nAmazon,US\n\nWalmart,US\n"], "companies.csv", { type: "text/csv" });
    const parsed = await parseSpreadsheet(file);

    expect(parsed.headerRowNumber).toBe(2);
    expect(parsed.sourceRowNumbers).toEqual([3, 5]);
    expect(parsed.rows.map((row) => row.company)).toEqual(["Amazon", "Walmart"]);

    const exported = await exportSpreadsheet(parsed, ["website"], new Map([
      ["row-1", { website: "https://amazon.com" }],
      ["row-2", { website: "https://walmart.com" }]
    ]));
    expect(await exported.blob.text()).toBe(",,\r\ncompany,country,website\r\nAmazon,US,https://amazon.com\r\n,,\r\nWalmart,US,https://walmart.com\r\n,,");
  });

  it("writes generated Excel headers beside the actual header row", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Data");
    worksheet.getRow(2).values = ["company"];
    worksheet.getRow(3).values = ["Amazon"];
    const input = new Uint8Array(await workbook.xlsx.writeBuffer());
    const parsed = await parseSpreadsheet(new File([input], "companies.xlsx"));

    expect(parsed.headerRowNumber).toBe(2);
    expect(parsed.rows[0].company).toBe("Amazon");
    const exported = await exportSpreadsheet(parsed, ["website"], new Map([["row-1", { website: "https://amazon.com" }]]));
    const resultBook = new ExcelJS.Workbook();
    await resultBook.xlsx.load(await exported.blob.arrayBuffer());
    const resultSheet = resultBook.getWorksheet("Data")!;
    expect(resultSheet.getCell(1, 2).value).toBeNull();
    expect(resultSheet.getCell(2, 2).value).toBe("website");
    expect(resultSheet.getCell(3, 2).value).toBe("https://amazon.com");
  });
});
