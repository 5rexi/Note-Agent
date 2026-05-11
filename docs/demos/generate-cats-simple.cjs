const pptxgen = require("pptxgenjs");

let pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.title = "All About Cats";

// Slide 1 - Title
let slide1 = pres.addSlide();
slide1.background = { color: "2C3E50" };
slide1.addText("All About Cats", {
  x: 0.5, y: 2, w: 9, h: 1.5,
  fontSize: 54, bold: true, color: "FFFFFF", align: "center"
});
slide1.addText("A Purrfect Introduction", {
  x: 0.5, y: 3.5, w: 9, h: 0.6,
  fontSize: 24, color: "E67E22", align: "center"
});

// Slide 2 - Fun Facts
let slide2 = pres.addSlide();
slide2.background = { color: "ECF0F1" };
slide2.addText("Fun Facts", {
  x: 0.5, y: 0.5, w: 9, h: 0.8,
  fontSize: 36, bold: true, color: "2C3E50"
});

const facts = [
  "Cats sleep 70% of their lives",
  "A cat's purr vibrates at 25-150 Hz",
  "Cats can rotate their ears 180°",
  "The oldest cat video is from 1894"
];
slide2.addText(
  facts.map((f, i) => ({ text: f, options: { bullet: true, breakLine: i < facts.length - 1 } })),
  { x: 0.7, y: 1.5, w: 8.5, h: 3.5, fontSize: 22, color: "34495E", paraSpaceAfter: 14 }
);

// Slide 3 - Cat Breeds Table
let slide3 = pres.addSlide();
slide3.background = { color: "FFFFFF" };
slide3.addText("Popular Cat Breeds", {
  x: 0.5, y: 0.5, w: 9, h: 0.8,
  fontSize: 36, bold: true, color: "2C3E50"
});

const tableData = [
  [
    { text: "Breed", options: { bold: true, fill: { color: "E67E22" }, color: "FFFFFF" } },
    { text: "Origin", options: { bold: true, fill: { color: "E67E22" }, color: "FFFFFF" } },
    { text: "Temperament", options: { bold: true, fill: { color: "E67E22" }, color: "FFFFFF" } }
  ],
  ["Persian", "Iran", "Calm & Gentle"],
  ["Siamese", "Thailand", "Social & Vocal"],
  ["Maine Coon", "USA", "Friendly & Playful"],
  ["British Shorthair", "UK", "Easygoing & Loyal"]
];
slide3.addTable(tableData, {
  x: 0.5, y: 1.4, w: 9, h: 3,
  colW: [3, 3, 3],
  fontSize: 16,
  color: "2C3E50",
  border: { pt: 0.5, color: "BDC3C7" },
  align: "center",
  valign: "middle"
});

pres.writeFile({ fileName: "/tmp/cat-test.pptx" })
  .then(() => console.log("Saved: /tmp/cat-test.pptx"))
  .catch(err => console.error(err));
