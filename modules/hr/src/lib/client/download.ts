export function downloadTextFile(filename: string, content: string, mimeType = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function csv(rows: Array<Array<string | number>>) {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const value = String(cell);
          return value.includes(",") || value.includes("\n") ? `"${value.replaceAll("\"", "\"\"")}"` : value;
        })
        .join(","),
    )
    .join("\n");
}
