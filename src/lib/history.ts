import { HISTORY_PHOTO_FILES, type HistoryPhotoKey } from "@/lib/historyPhotos";

/**
 * The Edison Mandir History page (/history): the events as the organisers' history list gives
 * them (2026-10-02) and their additions of 2026-10-06 (with photographs: the close of the CFI and
 * August 21 in 1991, May 29 to June 5 in 1994, the 1995 visit, August 6 and the nagar yatra in
 * 1996; then 1988's Inman Avenue stay, and July 9, the travel report and the CFI planning in 1990), in order, grouped into five parts named by their years only. An addition is one entry
 * per paragraph of theirs, with the photographs that show it (they sent each message's
 * photographs with it); its year is the one the message gives or follows from (August 21 comes
 * right after the CFI and speaks of "this past month" of it, so it is 1991).
 *
 * Pure data, client-safe. The wording is the organisers', tidied for spelling and grammar; never
 * add a fact (a date, a place, a number, who was there) they don't give. Content changes are
 * an edit here (a deploy). The photographs' files come from scripts/build-history-photos.py
 * (src/lib/historyPhotos.ts); an alt text describes what is visible and names no one.
 */

export type HistoryPhoto = { key: HistoryPhotoKey; alt: string };

export type HistoryEntry = {
  id: string;
  /** One or two sentences; the day reads in the sentence (there is no title or date field). */
  text: string;
  /** An exact substring of `text`, quotation marks included, shown in the display face. */
  quote?: { text: string; lang?: "gu-Latn" };
  /** The event's photographs, in the order they are shown. */
  photos?: { caption: string; items: HistoryPhoto[] };
};

export type HistoryYear = { year: number; entries: HistoryEntry[] };
export type HistoryPart = { id: string; years: HistoryYear[] };

export const HISTORY: HistoryPart[] = [
  {
    id: "part-1",
    years: [
      {
        year: 1974,
        entries: [{ id: "1974-first-vicharan", text: "The first vicharan took place on July 12." }],
      },
      {
        year: 1988,
        entries: [
          {
            // The organisers' message of 2026-10-06 replaces the list's line ("September 21:
            // Swamishri stayed on Inman Ave for 12 days and gave kathas to fulfill the wishes of the
            // devotees."), telling the same stay in detail.
            id: "1988-inman-ave",
            text: "Edison was fortunate to be graced by Swamishri on September 21. He stayed at this house on Inman Avenue for 12 days. He gave immense bliss to all while planting the seeds for the future mandir. In an evening sabha, Swamishri had the santos sing kirtans, and then he delivered a discourse on Vachanamrut Gadhada II-41 for 1.5 hours, to the pleasure of all the devotees.",
            photos: {
              // No year: the photograph is a recent one of the house (the organisers date the stay, not it).
              caption: "The house on Inman Avenue",
              items: [
                {
                  key: "ia88-1",
                  alt: "A two-storey red brick house with white-framed windows, a dark double front door at the top of steps with white railings, a red-leaved shrub, a two-car garage with white doors and a green front lawn with a mailbox at the curb, on a rainy day.",
                },
              ],
            },
          },
        ],
      },
    ],
  },
  {
    id: "part-2",
    years: [
      {
        year: 1990,
        entries: [
          {
            id: "1990-cfi-site",
            // The list says only "C.F.I". The name is spelled out here and in the 1991 plate's
            // caption: the banner in the 1994 Expo Hall photograph (eh94-1) reads "Cultural
            // Festival of India" in full.
            text: "On July 8, the day of Guru Punam, Pramukh Swami Maharaj visited the site of the Cultural Festival of India (CFI).",
          },
          {
            // The organisers' message of 2026-10-06 replaces the list's line ("On July 9, Pramukh
            // Swami Maharaj visited a factory at 2500 Woodbridge Ave, the location of Edison Mandir,
            // and sprinkled sanctified flowers on the grounds."), telling the same visit in detail.
            id: "1990-woodbridge-ave",
            text: "July 9 was a very special day for the devotees of Edison, NJ. On this day, Swamishri came to visit a warehouse at 2500 Woodbridge Avenue and gave instructions to purchase this land. He himself showered flower petals around the site and gave blessings that this site would one day be a majestic mandir.",
            photos: {
              caption: "The warehouse at 2500 Woodbridge Avenue",
              items: [
                {
                  key: "wb90-1",
                  alt: "A long, low white industrial building with rows of large steel-framed windows and a chimney on its roof; cars are parked in a line along its side, a grass verge with a curb runs in the foreground, and an empty billboard frame stands at the far end.",
                },
                {
                  key: "wb90-2",
                  alt: "Seen from across a road, a low white industrial building with large windows and a wing of red brick, partly hidden behind dark evergreen trees and a bare tree; a chain-link fence with an open gate runs along the front, and cars are parked beside the building.",
                },
              ],
            },
          },
          {
            id: "1990-travel-report",
            text: "In his travel reports, Swamishri himself writes, “A six-acre piece of land in New Jersey has been purchased. Because of this, the present satsang will grow. May you all remain happy.” With these words, Swamishri prophesied the growth of satsang in New Jersey.",
            quote: {
              text: "“A six-acre piece of land in New Jersey has been purchased. Because of this, the present satsang will grow. May you all remain happy.”",
            },
            photos: {
              caption: "A handwritten page",
              items: [
                {
                  key: "tr90-1",
                  alt: "A handwritten page of flowing lines in an Indian script, in grey ink except for a band of about four lines below the middle written in darker ink; a few words are scribbled out or struck through.",
                },
              ],
            },
          },
          {
            id: "1990-cfi-planning",
            text: "After Swamishri left America, Mahant Swami stayed back to help with the planning efforts for the CFI. He spoke to the volunteers about giving their time and doing seva mentally, physically and financially. In this way, he took on the responsibility of inspiring all the volunteers.",
            photos: {
              caption: "Planning the CFI, 1990",
              items: [
                {
                  key: "cp90-1",
                  alt: "In a room with wood-panelled walls, two sadhus in saffron robes and turbans sit on red striped sofas beside a tall lamp on a side table: one, with a red mark on his forehead, leans forward, and the other sits cross-legged with one hand held out; men sit around them, one in a checked shirt in the foreground with his back to the camera.",
                },
              ],
            },
          },
        ],
      },
      {
        year: 1991,
        entries: [
          {
            id: "1991-cfi",
            text: "The CFI took place at Middlesex County College. This immensely helped BAPS become known across America.",
            photos: {
              caption: "Cultural Festival of India, 1991",
              items: [
                {
                  key: "cfi-1",
                  alt: "A sadhu in saffron robes sits in an armchair on a lawn in front of a large triple arch decorated with peacocks and swans, under a clear blue sky.",
                },
                {
                  key: "cfi-2",
                  alt: "A sadhu in saffron robes and turban, wearing sunglasses, sits with hands clasped on a stage hung with embroidered cloth; a volunteer in a striped turban sits behind.",
                },
                {
                  key: "cfi-3",
                  alt: "On a stage under a long banner whose first line begins “Cultural Festi…”, a sadhu in saffron robes and turban releases a white dove; a volunteer in festival dress and a striped turban stands behind him.",
                },
              ],
            },
          },
          {
            id: "1991-world-peace-yagna",
            text: "On July 21, a World Peace Yagna was performed at 2500 Woodbridge Ave, the factory that would become Edison Mandir.",
          },
          {
            id: "1991-murti-pratishtha",
            text: "On August 8, the Murti Pratishtha of Edison Mandir was performed with great utsah, with santos and thousands of devotees.",
          },
          {
            // cc91-1 shows a seated ceremony, not the clearing: the organisers sent it with this
            // message, so it stays here; to be confirmed with them.
            id: "1991-cfi-clearing",
            text: "As the CFI came to a close, santos and devotees spent one week clearing the site. Every day, Swamishri would be among the devotees performing service. Even Mahant Swami helped with cleaning and picking up trash: he would reach into thick, thorny bushes to remove cans and other litter. The Gunatit Gurus! They are true examples of the ideal servant.",
            photos: {
              caption: "The close of the CFI, 1991",
              items: [
                {
                  key: "cc91-1",
                  alt: "Sadhus in saffron robes, most in saffron turbans, sit on a deep pink carpet among rows of seated men mostly dressed in white; metal plates and bowls of flowers and puja items are set out before them, and a man in a dark suit sits beside them with folded hands.",
                },
                {
                  key: "cc91-2",
                  alt: "Under the arched metal frame of a large tent, open to the sky, a man in a white hard hat sits at the controls of a yellow loader whose arm reaches down to a metal post in the gravel, where two men crouch; a sadhu in saffron robes stands watching behind them, with trees and a trailer beyond.",
                },
              ],
            },
          },
          {
            id: "1991-first-puja",
            text: "On the auspicious day of Ekadashi, August 21, Swamishri performed his morning puja at Edison Mandir for the first time. In his blessings, Swamishri said, “We have given our wealth, homes and families for God and his sadhu, so our lives have also become fulfilled… The mandir is ready, so all should attend, take part and give motivation to others.”",
            photos: {
              caption: "The first morning puja at Edison Mandir, 1991",
              items: [
                {
                  key: "ep91-1",
                  alt: "On a stage with carved, painted pillars behind, a sadhu in saffron robes sits cross-legged on a white-covered platform and holds a small stick to his forehead during his puja; beside him, a younger sadhu in saffron robes and glasses looks down at his hands.",
                },
              ],
            },
          },
          {
            id: "1991-cfi-farewell",
            text: "On August 21, as Swamishri left the mandir, he wished to go to Middlesex County College (the CFI location) again. From the car, he showed his reverence to the different areas by saying, “Jay to the parking lot! Jay to the trailer! You have given us so much happiness this past month. Jay to the college! Jay Swaminarayan to all! We wish this college well for giving us the land to do CFI. We pray that those who attend this college study well and that their lives are uplifted and filled with happiness.” While leaving the site, Swamishri took a final glance at MCC and again said the whole jaynaad, with the addition of “Jay to Middlesex County!”",
            quote: { text: "“Jay to Middlesex County!”" },
            photos: {
              caption: "Middlesex County College, the CFI location",
              items: [
                {
                  key: "ep91-2",
                  alt: "A low white wall with a square pillar at each end bears black letters reading “Middlesex County College”; a black iron fence runs along its top, a trimmed hedge grows in front, and trees with bright red and orange autumn leaves rise behind it, the sun shining through them.",
                },
              ],
            },
          },
        ],
      },
    ],
  },
  {
    id: "part-3",
    years: [
      {
        year: 1994,
        // The organisers' messages of 2026-10-06 replace the list's one-line summary ("Three years
        // after the Murti Pratishtha and the CFI, Swamishri returned to Edison and made a memorable
        // visit to the Poconos."): they tell the same return and the same visit, in detail.
        entries: [
          {
            id: "1994-expo-hall",
            text: "On May 29, Swamishri returned to Edison, three years after the CFI. Upon his arrival at Expo Hall, over 50 representatives of various Indian organizations came to specially welcome Swamishri back to America. The police department welcomed Swamishri by presenting him with the ‘Member of the Honor Legion’ medal. During the welcome assembly, Swamishri casually fixed a broken garland by removing a few flowers from each side, exposing more string and tying it together, all while speaking to a dignitary! Everyone was amazed by his skillful ability.",
            photos: {
              caption: "The welcome at Expo Hall, May 29, 1994",
              items: [
                {
                  key: "eh94-1",
                  alt: "On a stage under a banner reading “H.D.H. Pramukh Swami Maharaj, Inspirer of Cultural Festival of India, by: Associations of Indians, USA, May 29, 1994”, a sadhu in saffron robes sits on an ornate canopied seat before pink arches painted with turbaned figures; a row of men and two sadhus sit in front of him, and more men stand behind them on either side, many in suits and others in white shirts and kurtas.",
                },
              ],
            },
          },
          {
            id: "1994-dry-fruit-garland",
            text: "On June 2, Swamishri came to Edison Mandir. He lovingly accepted a garland made from dry fruit by the devotees. After commencing the Sanyukta Shibir, he went to his utaro at Jitubhai Patel’s place near the mandir.",
            photos: {
              caption: "June 2, 1994",
              items: [
                {
                  key: "dg94-1",
                  alt: "A sadhu in saffron robes, looking down, holds with both hands a thick garland of dried fruit hung around his neck, its lower part trimmed with red tassels, pale green clusters and pink roses.",
                },
                {
                  key: "dg94-2",
                  alt: "Sadhus in saffron robes and turbans help an older sadhu, also in a saffron turban, step out of the doorway of a brick house, under a banner reading “Jay Shri Swaminarayan” in Gujarati; men stand on either side of the doorway.",
                },
                {
                  key: "dg94-3",
                  alt: "In a fenced backyard under tall evergreen trees, men and boys sit on the grass holding papers, with a sadhu in saffron robes seated among them, while another sadhu in saffron robes walks along a red carpet laid across the lawn; a few men stand by the fence.",
                },
              ],
            },
          },
          {
            id: "1994-ekadashi",
            text: "June 5 was Ekadashi. Swamishri came to Edison Mandir to perform his puja. From a logistical perspective, the driver did not stop by the main entrance but instead took the car to the secondary entrance. Swamishri immediately said, “No, take the car back to the main entrance. I want to do darshan of Thakorji first.” Such was Swamishri’s desire to do darshan on the day of Ekadashi.",
            quote: { text: "“No, take the car back to the main entrance. I want to do darshan of Thakorji first.”" },
            photos: {
              // The message sent this photograph and ek94-2 with both paragraphs; this one, a puja on
              // a stage, is read as June 5's (the other shows the Poconos lawn). To be confirmed.
              caption: "June 1994",
              items: [
                {
                  key: "ek94-1",
                  alt: "Under a canopy of draped, striped cloth, a sadhu in saffron robes sits cross-legged on a white-draped platform with puja items before him and another sadhu beside him; young men with a tabla and a microphone sit to one side, and two sadhus sit in the foreground.",
                },
              ],
            },
          },
          {
            id: "1994-poconos",
            text: "Swamishri then spent one and a half days with the children and youth at a convention in the Poconos. Postponing his other priorities, Swamishri gave them his full attention. Whatever wishes they had, Swamishri fulfilled them without hesitation: playing, eating, giving darshan and sharing priceless, joyful moments with them.",
            photos: {
              caption: "The convention in the Poconos, 1994",
              items: [
                {
                  key: "ek94-2",
                  alt: "On a wide, sunlit lawn among tall trees, with a low building behind, boys and young men stand with their arms raised above their heads while others sit in a long row on the grass; a sadhu in saffron robes walks across the grass in front of them.",
                },
              ],
            },
          },
        ],
      },
      {
        year: 1995,
        entries: [
          {
            id: "1995-amrut-mahotsav",
            text: "In anticipation of Pramukh Swami Maharaj’s Amrut Mahotsav, Mahant Swami, along with other santos, arrived in America to speak to all the devotees about the numerous virtues of our Guru.",
            photos: {
              caption: "Before the Amrut Mahotsav, 1995",
              items: [
                {
                  key: "ms95-1",
                  alt: "In a hall full of seated devotees, a sadhu in saffron robes speaks into a microphone from a seat draped in yellow cloth on a stage under a canopy of colored cloth; framed portraits and a gold panel stand behind him, sadhus sit along the stage, and to the left murtis stand in arched niches below a banner whose words include “Amrut Mahotsav”.",
                },
              ],
            },
          },
          {
            id: "1995-departments",
            text: "While in Edison, Mahant Swami had meetings with each department in the mandir. He also provided guidance on the renovation work.",
            photos: {
              caption: "With the mandir’s departments, 1995",
              items: [
                {
                  key: "ms95-2",
                  alt: "In a kitchen with steel walls, a smiling sadhu in saffron robes stirs a large metal pot with a long wooden paddle while a man beside him stirs it with another; more men stand around them smiling, most in blue shirts.",
                },
                {
                  key: "ms95-3",
                  alt: "A smiling sadhu in saffron robes stands at an open doorway with men and a teenage boy, some with their hands folded or clasped; through the doorway is a room with steel walls and a strip light.",
                },
              ],
            },
          },
        ],
      },
      {
        year: 1996,
        entries: [
          {
            id: "1996-arrival",
            text: "On August 6, Swamishri arrived in Edison. After taking a glance at the new stonework, Swamishri instantly said, “This has been made amazingly well!”",
            quote: { text: "“This has been made amazingly well!”" },
          },
          {
            id: "1996-reopening",
            text: "August 11 was the great day of the reopening of the mandir, with a new sinhasan and new murtis.",
            photos: {
              caption: "Murti Pratishtha, 1996",
              items: [
                {
                  key: "mp96-1",
                  alt: "A sadhu in saffron robes stands with folded hands before two marble murtis dressed in blue and garlanded with red flowers, and a smaller murti to their left, under a carved wooden sinhasan; a garlanded painting of four gurus stands beside them, and sadhus sit in front.",
                },
                {
                  key: "mp96-2",
                  alt: "Seated before offerings of fruit, coconuts and flowers laid out on red cloth, a sadhu in saffron robes places a flower on a coconut; another sadhu sits beside him and rows of devotees sit behind.",
                },
                {
                  key: "mp96-3",
                  alt: "A sadhu in saffron robes makes an offering before two marble murtis dressed in blue with garlands of red flowers.",
                },
              ],
            },
          },
          {
            id: "1996-nagar-yatra",
            text: "That day, Swamishri performed his puja in the rear of the mandir and then sat on a horse-drawn carriage that took him to the front entrance of the mandir. This was the nagar yatra! A Vedic Pujan was performed at the new entrance.",
            photos: {
              caption: "Nagar yatra, 1996",
              items: [
                {
                  key: "ny96-1",
                  alt: "Two photographs, one above the other: above, a man in a dark suit leads a white horse drawing a white carriage through a crowd in front of a carved pink stone building, with a police officer nearby and sadhus in saffron robes walking beside it; below, a smiling sadhu in saffron robes sits in the carriage among garlands as sadhus gather close around it.",
                },
                {
                  key: "ny96-2",
                  alt: "In an open doorway, a sadhu in saffron robes holds up a handful of flower petals behind a red cord stretched across it; men in front hold plates of flowers, small bowls and coconuts, sadhus and devotees crowd behind him, and carved stone pillars stand outside.",
                },
              ],
            },
          },
        ],
      },
      {
        year: 1997,
        entries: [
          {
            id: "1997-visit",
            text: "Mahant Swami Maharaj graced Edison Mandir yet again, showering immense bliss upon the devotees during this visit.",
          },
        ],
      },
      {
        year: 1998,
        entries: [
          {
            id: "1998-recovery",
            text: "After his bypass surgery, Pramukh Swami Maharaj was recovering in Westchester, NY. However, he had an intense desire to do the darshan of the murtis of Edison Mandir.",
          },
          {
            id: "1998-arrival",
            text: "Swamishri arrived in Edison on September 11 and gave the balaks immense labh.",
          },
          {
            id: "1998-departure",
            text: "On September 21, Pramukh Swami Maharaj left Edison for New York.",
          },
        ],
      },
      {
        year: 2000,
        entries: [
          {
            id: "2000-return",
            text: "Pramukh Swami Maharaj returned to Edison, where the devotees were waiting for his arrival.",
          },
          {
            id: "2000-annakut",
            text: "Pramukh Swami Maharaj also celebrated the annakut festival in Edison that year.",
          },
        ],
      },
    ],
  },
  {
    id: "part-4",
    years: [
      {
        year: 2002,
        entries: [
          {
            id: "2002-finally-home",
            text: "Upon arriving in Edison, Mahant Swami Maharaj said, “Ahh! We’re finally home.”",
            quote: { text: "“Ahh! We’re finally home.”" },
          },
        ],
      },
      {
        year: 2004,
        entries: [
          {
            id: "2004-satsang-flourished",
            text: "On May 22, at the age of 84, Pramukh Swami Maharaj graced New Jersey yet again and said, “Satsang has flourished in America.”",
            quote: { text: "“Satsang has flourished in America.”" },
          },
        ],
      },
      {
        year: 2007,
        entries: [
          {
            id: "2007-nilkanth-varni",
            text: "Pramukh Swami Maharaj arrived in Edison and performed the Nilkanth Varni Pratishtha.",
          },
          {
            id: "2007-jal-jhini",
            text: "Pramukh Swami Maharaj celebrated the Jal Jhini Utsav in Edison, filling haribhakto with lifetime smrutis.",
          },
        ],
      },
      {
        year: 2011,
        entries: [{ id: "2011-shibir", text: "Mahant Swami Maharaj came to Edison for a shibir." }],
      },
      {
        year: 2014,
        entries: [
          {
            id: "2014-last-visit",
            text: "Out of compassion, at the age of 94, Pramukh Swami Maharaj stopped at the Edison Mandir grounds for the last time, on his way to JFK hospital.",
          },
        ],
      },
    ],
  },
  {
    id: "part-5",
    years: [
      {
        year: 2015,
        entries: [{ id: "2015-ashirwad", text: "Mahant Swami Maharaj gave ashirwad for the new mandir." }],
      },
      {
        year: 2016,
        entries: [
          {
            id: "2016-nirman-vidhi",
            text: "In Sarangpur, Pramukh Swami Maharaj performed the Nutan Mandir Nirman Vidhi.",
          },
        ],
      },
      {
        year: 2017,
        entries: [
          {
            id: "2017-divya-sandesh",
            text: "Mahant Swami Maharaj delivered the famous “Sampthi Chamatkar Sarjay Che Te Edison Mandir E Divya Sandesh Puru Pade Che.”",
            // Letter for letter as the organisers' list gives it.
            quote: {
              text: "“Sampthi Chamatkar Sarjay Che Te Edison Mandir E Divya Sandesh Puru Pade Che.”",
              lang: "gu-Latn",
            },
          },
          {
            id: "2017-ghanshyam-maharaj",
            text: "Mahant Swami Maharaj arrived on September 6, in the presence of many sadhus and devotees, and also celebrated his birthday at Edison Mandir. He also performed the Ghanshyam Maharaj Murti Pratishtha.",
            photos: {
              caption: "Ghanshyam Maharaj Murti Pratishtha, 2017",
              items: [
                {
                  key: "gm17-1",
                  alt: "A hall filled with seated devotees; in the foreground, rows of sadhus in saffron robes and a sadhu in a saffron turban seated on a chair, with colorful balloons overhead.",
                },
                {
                  key: "gm17-2",
                  alt: "A sadhu in saffron robes and turban, seated in an armchair on a stage decorated with flowers, speaks into a microphone; a small garlanded murti stands on a pedestal beside him.",
                },
                {
                  key: "gm17-3",
                  alt: "A sadhu in saffron robes and turban reaches up to the gold crown of a white marble murti standing in a carved, gilded doorway.",
                },
              ],
            },
          },
        ],
      },
      {
        year: 2019,
        entries: [
          {
            id: "2019-guru-parampara",
            text: "Mahant Swami Maharaj performed the Guru Parampara Murti Pratishtha vidhi.",
          },
          {
            id: "2019-mahotsav",
            // A placeholder sentence: the list has no line for the Mahotsav. The organisers' own
            // wording replaces it; until then it says no more than the event's name does.
            text: "The Mahotsav of the new mandir was celebrated.",
            photos: {
              caption: "New Mandir Mahotsav, 2019",
              items: [
                {
                  key: "mm19-1",
                  alt: "A sadhu in saffron robes and turban holds a thin red wand to the face of a seated marble murti of a guru robed in saffron, inside a gilded shrine.",
                },
                {
                  key: "mm19-2",
                  alt: "A sadhu in saffron robes and turban pours water from a small spoon over the head of a white marble murti draped in red cloth, inside a gilded shrine.",
                },
                {
                  key: "mm19-3",
                  alt: "A sadhu in saffron robes and turban offers arti with a lit lamp before gilded shrines; tiers of sweets are arranged as annakut in front of the murtis.",
                },
              ],
            },
          },
        ],
      },
    ],
  },
];

/** One year of the timeline, as the year strip and the page's jumps see it. */
export type HistoryYearInfo = {
  year: number;
  /** 1-based number of the part the year is in. */
  part: number;
  /** The first year of its part. */
  startsPart: boolean;
  /** One of its events has photographs. */
  hasPhotos: boolean;
  /** Years since the year before it that have no event (drawn as ticks above it). */
  skipped: number;
};

export function historyYears(parts: HistoryPart[] = HISTORY): HistoryYearInfo[] {
  const years: HistoryYearInfo[] = [];
  parts.forEach((part, p) => {
    part.years.forEach((y, i) => {
      const before = years[years.length - 1];
      years.push({
        year: y.year,
        part: p + 1,
        startsPart: i === 0,
        hasPhotos: y.entries.some((e) => e.photos !== undefined),
        skipped: before ? Math.max(0, y.year - before.year - 1) : 0,
      });
    });
  });
  return years;
}

/** How many events and photographs: the whole timeline, or one part of it. */
export function historyCounts(parts: HistoryPart[] = HISTORY): { events: number; photos: number } {
  let events = 0;
  let photos = 0;
  for (const part of parts) {
    for (const y of part.years) {
      events += y.entries.length;
      for (const e of y.entries) photos += e.photos?.items.length ?? 0;
    }
  }
  return { events, photos };
}

/** "27 events · 12 photographs"; the photographs are left out when there are none. */
export function historyCountsLabel(counts: { events: number; photos: number }): string {
  const events = `${counts.events} ${counts.events === 1 ? "event" : "events"}`;
  if (counts.photos === 0) return events;
  return `${events} · ${photographsLabel(counts.photos)}`;
}

export function photographsLabel(n: number): string {
  return `${n} ${n === 1 ? "photograph" : "photographs"}`;
}

/** The DOM id of a year's heading (the strip's links and the opening's "Begin at 1974"). */
export function yearAnchor(year: number): string {
  return `year-${year}`;
}

/**
 * An entry's text around its quote. When the quote isn't an exact substring of the text (an
 * edit that forgot one of the two) the whole text comes back as `before`, with no quote.
 */
export function splitQuote(entry: Pick<HistoryEntry, "text" | "quote">): {
  before: string;
  quote: string;
  after: string;
} {
  const quote = entry.quote?.text ?? "";
  const at = quote ? entry.text.indexOf(quote) : -1;
  if (at < 0) return { before: entry.text, quote: "", after: "" };
  return {
    before: entry.text.slice(0, at).trimEnd(),
    quote,
    after: entry.text.slice(at + quote.length).trimStart(),
  };
}

/**
 * A photograph's web copies (public/history/photos/, built by scripts/build-history-photos.py):
 * the page's 960 and 1280 px wide copies (or the original's width when that is smaller: then
 * listed once) and the viewer's full one, each with its pixel size.
 * Every URL carries the files' content hash (`?v=`), so next.config.ts can cache them for good.
 * Under /history/, so the middleware serves them to signed-in guests only.
 */
export function historyPhotoSources(key: HistoryPhotoKey) {
  const file = HISTORY_PHOTO_FILES[key];
  const url = (size: "960" | "1280" | "full") => `/history/photos/${key}-${size}.webp?v=${file.v}`;
  const [width, height] = file.w960;
  // From a smaller original both page copies are the original's size: list that width once.
  const srcSet =
    file.w1280[0] > file.w960[0]
      ? `${url("960")} ${file.w960[0]}w, ${url("1280")} ${file.w1280[0]}w`
      : `${url("960")} ${file.w960[0]}w`;
  return {
    src: url("960"),
    srcSet,
    width,
    height,
    full: { src: url("full"), width: file.full[0], height: file.full[1] },
  };
}
