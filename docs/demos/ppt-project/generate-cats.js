const pptxgen = require("pptxgenjs");

let pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.title = "All About Cats";
pres.author = "Note Agent";

// Slide 1 - Title
let slide1 = pres.addSlide();
slide1.background = { color: "2C3E50" };

// Title shape
slide1.addShape(pres.shapes.ROUNDED_RECTANGLE, {
  x: 1, y: 1.5, w: 8, h: 1.5,
  fill: { color: "E67E22" },
  rectRadius: 0.15
});

slide1.addText("All About Cats", {
  x: 1, y: 1.5, w: 8, h: 1.5,
  fontSize: 44, bold: true, color: "FFFFFF",
  align: "center", valign: "middle", margin: 0
});

slide1.addText("A Purrfect Introduction", {
  x: 1, y: 3.3, w: 8, h: 0.6,
  fontSize: 20, color: "BDC3C7", align: "center"
});

// Slide 2 - Fun Facts
let slide2 = pres.addSlide();
slide2.background = { color: "ECF0F1" };

slide2.addText("Fun Facts", {
  x: 0.5, y: 0.3, w: 9, h: 0.8,
  fontSize: 36, bold: true, color: "2C3E50", align: "left"
});

// Accent bar
slide2.addShape(pres.shapes.RECTANGLE, {
  x: 0.5, y: 1.1, w: 1.5, h: 0.08,
  fill: { color: "E67E22" }
});

// Facts list
const facts = [
  "Cats sleep 70% of their lives",
  "A cat's purr vibrates at 25-150 Hz",
  "Cats can rotate their ears 180°",
  "The oldest cat video is from 1894"
];

slide2.addText(
  facts.map((f, i) => ({
    text: f,
    options: { bullet: true, breakLine: i < facts.length - 1 }
  })),
  { x: 0.7, y: 1.5, w: 8.5, h: 3.5, fontSize: 22, color: "34495E", paraSpaceAfter: 14 }
);

// Slide 3 - Cat Types Table
let slide3 = pres.addSlide();
slide3.background = { color: "FFFFFF" };

slide3.addText("Popular Cat Breeds", {
  x: 0.5, y: 0.3, w: 9, h: 0.8,
  fontSize: 36, bold: true, color: "2C3E50", align: "left"
});

// Table
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
  x: 0.5, y: 1.3, w: 9, h: 3.2,
  colW: [3, 3, 3],
  fontSize: 16,
  color: "2C3E50",
  border: { pt: 0.5, color: "BDC3C7" },
  align: "center",
  valign: "middle"
});

// Save
pres.writeFile({ fileName: "/tmp/cat-presentation.pptx" })
  .then(() => console.log("Saved: /tmp/cat-presentation.pptx"))
  .catch(err => console.error(err));