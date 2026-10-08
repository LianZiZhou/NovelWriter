import type { ScenarioFile } from '@novelwriter/core';

type Starter = Pick<ScenarioFile, 'title' | 'description' | 'author' | 'tags' | 'mode' | 'prompt' | 'memory' | 'authorsNote'> & { placeholders?: ScenarioFile['placeholders'] };

/** Original starter scenarios shipped with the app. */
export const STARTERS: Starter[] = [
  {
    title: 'The Lantern Keeper',
    author: 'NovelWriter',
    description: 'In a city where the night is alive, you tend the lanterns that keep it at bay. Tonight, one has gone out.',
    tags: ['fantasy', 'mystery'],
    mode: 'storyteller',
    memory: 'The city of Veylan is protected from the living dark by enchanted lanterns. ${name[Ilsa]} is a lantern keeper.',
    authorsNote: '[ Style: atmospheric, slow-burning mystery ]',
    prompt:
      'The lantern on Cobbler\'s Row had gone out, and in thirty years of keeping, ${name[Ilsa]} had never once seen that happen. She stood beneath it with her ladder over one shoulder, staring up at the cold glass, while the dark at the end of the street leaned closer to listen.',
    placeholders: [{ key: 'name', defaultValue: 'Ilsa', description: "The lantern keeper's name" }],
  },
  {
    title: 'Signal From Kepler Station',
    author: 'NovelWriter',
    description: 'The research station went silent eleven years ago. This morning, it called home.',
    tags: ['sci-fi', 'thriller'],
    mode: 'storyteller',
    memory: 'Kepler Station is an abandoned deep-space research outpost. The narrator is a communications officer aboard the relief ship Halcyon.',
    authorsNote: '',
    prompt:
      'The message arrived at 04:12 ship time, wrapped in an encryption scheme that had been retired before I was born. When the decoder finally spat out plain text, the whole bridge went quiet. It was three words long, and it was signed by a woman who had been dead for eleven years.',
  },
  {
    title: 'The Sunken Library',
    author: 'NovelWriter',
    description: 'Dive beneath the lake to explore a library swallowed by the water centuries ago.',
    tags: ['adventure', 'fantasy'],
    mode: 'adventure',
    memory: 'You are ${name[a treasure diver]}. The Sunken Library lies beneath Lake Morrow and is said to hold a book that can rewrite memories.',
    authorsNote: '',
    prompt:
      'The water is colder than the stories promised. Your lantern carves a narrow tunnel of light through the green gloom, and there, below you, the domed roof of the Sunken Library rises from the silt like the back of a sleeping whale. A single round window glows faintly from within.\n> You swim toward the glowing window.\nUp close, the glass is etched with a spiral of letters you almost recognize. Beyond it, shelves stretch away into darkness, their books swollen but somehow unbroken.',
    placeholders: [{ key: 'name', defaultValue: 'a treasure diver', description: 'Who are you?' }],
  },
  {
    title: 'Last Train to Ashford',
    author: 'NovelWriter',
    description: 'A night train, seven strangers, and a conductor who will not say where the line ends.',
    tags: ['mystery', 'drama'],
    mode: 'storyteller',
    memory: 'Seven passengers share the last carriage of a night train to Ashford. None of them remember buying a ticket.',
    authorsNote: '',
    prompt:
      'The 11:52 to Ashford was never on time, so when it pulled in exactly as the station clock struck the minute, Margaret should have known something was wrong. She found a seat in the last carriage, across from a man reading a newspaper dated tomorrow.',
  },
  {
    title: 'The Mended Teacup',
    author: 'NovelWriter',
    description: 'A small repair shop in a village of gentle magic, where broken things come with stories attached.',
    tags: ['fantasy', 'cozy', 'slice-of-life'],
    mode: 'storyteller',
    memory: '${name[Bram]} runs the Mended Teacup, a repair shop in the hill village of Thistledown. Objects repaired with care there sometimes remember things their owners have forgotten.',
    authorsNote: '[ Style: warm, gentle, cozy fantasy ]',
    prompt:
      'The bell above the door of the Mended Teacup gave its cracked little jingle just as ${name[Bram]} was setting the kettle on. Outside, the first autumn rain was combing through the apple trees, and the whole of Thistledown smelled of wet leaves and woodsmoke.\nThe customer was a girl of perhaps nine, soaked to the ankles, holding a music box against her chest as though it might fly away. Its lid hung by a single hinge.\n"It stopped singing," she said. "Grandmother says it was only ever a toy. But it used to hum her name when she wound it, and now it won\'t."\n${name[Bram]} took the box gently in both hands. Somewhere deep inside, between the brass comb and the tiny drum, something shifted, like a sigh being held for a very long time.',
    placeholders: [{ key: 'name', defaultValue: 'Bram', description: "The shopkeeper's name" }],
  },
  {
    title: 'Rain on Harrow Street',
    author: 'NovelWriter',
    description: 'A tired private investigator, a missing pianist, and a city that never quite dries out.',
    tags: ['noir', 'mystery', 'crime'],
    mode: 'storyteller',
    memory: 'The story is narrated in first person by ${detective[Sam Calloway]}, a private investigator in the rain-soaked port city of Gravesend Bay. The year is uncertain, but the radios still have tubes and everyone smokes.',
    authorsNote: '[ Style: hardboiled noir, first person, wry and world-weary ]',
    prompt:
      'It had been raining on Harrow Street for six days, and the gutters had given up pretending they could handle it. I was halfway through a cold cup of coffee and a colder bank statement when she walked in without knocking.\nShe wore a green coat that cost more than my office and a look that said she had already decided I was a mistake. She put a photograph on my desk. A young man at a piano, smiling at somebody just outside the frame.\n"My brother," she said. "He played the late set at the Blue Anchor every night for three years. Four nights ago, he didn\'t show. The club says he quit. The police say he left town."\n"And you say?"\nShe lit a cigarette and looked at the rain. "I say he would never leave without his hands."',
    placeholders: [{ key: 'detective', defaultValue: 'Sam Calloway', description: "The detective's name" }],
  },
  {
    title: 'The Long Quiet Between Stars',
    author: 'NovelWriter',
    description: 'Captain a battered courier ship carrying a sealed cargo that three empires would kill to possess.',
    tags: ['sci-fi', 'space-opera', 'adventure'],
    mode: 'adventure',
    memory: 'You are Captain ${name[Rhee Okonta]} of the courier ship Wandering Tern, with a crew of two: Vask, a laconic engineer, and Juno, the ship\'s sardonic AI. The Concord, the Hollow Throne and the Free Drift are three powers locked in a cold war.',
    authorsNote: '',
    prompt:
      'The Wandering Tern drops out of the slipstream with a shudder that rattles every bolt in her hull. Through the forward viewport, the gas giant Meridian fills half the sky, banded in amber and violet. Somewhere in its rings, your contact is supposed to be waiting.\n"Captain," Juno says, in the bored tone she uses for bad news, "we have company. Two Hollow Throne frigates, running dark. They were here before us."\nBehind you, in the cargo hold, the sealed crate you were paid not to open hums softly to itself.\n> You order Vask to bring the engines to standby and hail the frigates.\nThe comm crackles. For a long moment there is only static. Then a calm voice answers, using your name, which no one out here should know.',
    placeholders: [{ key: 'name', defaultValue: 'Rhee Okonta', description: "Your captain's name" }],
  },
  {
    title: 'The House on Pell Hill',
    author: 'NovelWriter',
    description: 'You inherited a house from a great-aunt you never met. The house, it seems, has been expecting you.',
    tags: ['horror', 'mystery'],
    mode: 'adventure',
    memory: 'You have inherited an old house on Pell Hill from your great-aunt Wilhelmina. Locals avoid the hill after dark. The house has more rooms on the inside than windows on the outside.',
    authorsNote: '[ Style: creeping dread, quiet horror, no gore ]',
    prompt:
      'The lawyer would not drive you past the gate. He handed you a ring of iron keys through the car window, wished you luck in a voice that meant nothing of the kind, and was gone before the dust settled.\nThe house on Pell Hill is tall and narrow and grey, with a crooked weathervane shaped like a hand. Every curtain is drawn. As you walk up the overgrown path, you count the windows on the front: nine.\n> You unlock the front door and step inside.\nThe hall smells of lavender and old paper. A clock ticks somewhere deeper in the house, although your great-aunt has been dead for a month. On the side table, beside a vase of fresh flowers, lies a handwritten note addressed to you by name.',
  },
  {
    title: 'The Cartographer\'s Apprentice',
    author: 'NovelWriter',
    description: 'In a harbor town of the age of sail, a young apprentice discovers a map that charts an island no ship has ever found.',
    tags: ['historical', 'adventure', 'drama'],
    mode: 'storyteller',
    memory: 'The story is set in the fictional harbor town of Saltmere in the 1700s. Elinor Vance is apprenticed to the aging mapmaker Tobias Wren, whose eyesight is failing. Mapmaking is a guarded trade, and charts are worth more than gold.',
    authorsNote: '[ Style: rich period detail, measured prose ]',
    prompt:
      'Master Wren had gone to bed early with a fever, and so it fell to Elinor to close the shop. She banked the fire, wiped the copper plates, and was rolling the last of the day\'s charts when she noticed the loose board beneath his drafting table.\nShe should have left it. Every apprentice in Saltmere knew a mapmaker\'s secrets were his livelihood, and a girl caught prying could be turned out into the street by morning.\nInstead she knelt, lifted the board, and drew out a parcel wrapped in oilcloth. Inside lay a chart of the western sea, finer than any she had ever seen, drawn in Master Wren\'s own hand. And there, far beyond the last known soundings, he had inked a small crescent-shaped island and written beside it a single word: Returned.',
  },
  {
    title: 'Letters to the Lighthouse',
    author: 'NovelWriter',
    description: 'A lighthouse keeper on a remote island begins trading letters with a stranger on the mainland.',
    tags: ['romance', 'slice-of-life'],
    mode: 'storyteller',
    memory: '${keeper[Mara]} keeps the lighthouse on Grey Gull Island, reachable only by the weekly supply boat. ${writer[Theo]} is a bookbinder in the mainland town of Port Linden.',
    authorsNote: '[ Style: tender, epistolary, slow-burn romance ]',
    prompt:
      'The supply boat came on Thursdays, and on Thursdays ${keeper[Mara]} allowed herself exactly one hour of conversation with the boatman before the island went quiet again. This Thursday, along with the lamp oil and the flour, he handed her a small parcel wrapped in brown paper.\n"Came to the harbor office addressed to the Keeper," he said. "Nobody\'s written to the Keeper in twenty years."\nInside was a slim, hand-bound book with blank pages, and a folded letter.\n"Dear Keeper," it began. "I can see your light from my workshop window every night. I have decided it is the most dependable thing in my life, which is either very sweet or very sad. I made you this book. I hope you will write something in it and send it back. My name is ${writer[Theo]}."',
    placeholders: [
      { key: 'keeper', defaultValue: 'Mara', description: "The lighthouse keeper's name" },
      { key: 'writer', defaultValue: 'Theo', description: "The letter writer's name" },
    ],
  },
  {
    title: 'Seeds After the Ash',
    author: 'NovelWriter',
    description: 'Years after the sky burned, you carry the last seed vault key across a wasteland toward a rumored green valley.',
    tags: ['post-apocalyptic', 'survival'],
    mode: 'adventure',
    memory: 'You are ${name[Wren]}, a wanderer carrying the key to an old seed vault. Twelve years ago, the Ashfall darkened the sky and killed most crops. Scavenger bands called Rustmen roam the old highways.',
    authorsNote: '',
    prompt:
      'Dawn comes the color of weak tea, the way it always does now. You wake in the shell of an old filling station, your back against a rusted pump and the vault key on its cord warm against your chest.\nYour water skin is a third full. Your boots have perhaps another hundred miles in them. To the east, the cracked highway runs toward the mountains where, according to a dying trader, there is a valley where the grass still grows green.\n> You climb onto the station roof to look around.\nFrom up here you can see a thin column of smoke rising from the overpass two miles ahead. Cooking fire, or a signal. Below it, something glints in the grey light, like glass, or the scope of a rifle.',
    placeholders: [{ key: 'name', defaultValue: 'Wren', description: 'Your name' }],
  },
  {
    title: 'The Seventh Swan',
    author: 'NovelWriter',
    description: 'A retelling of the old tale of brothers turned to swans, told from the side of the youngest, who never fully turned back.',
    tags: ['fairy-tale', 'fantasy'],
    mode: 'storyteller',
    memory: 'Seven princes were cursed into swans by their stepmother and freed by their sister, who wove shirts of nettle in silence. The last shirt was unfinished, so the youngest brother, Aurel, kept one swan wing in place of an arm.',
    authorsNote: '[ Style: lyrical fairy-tale prose ]',
    prompt:
      'Everyone knows how the story ends: the sister at the stake, the six shirts of nettle flung over six white swans, the brothers rising up as men again while the crowd fell to its knees. Everyone knows the seventh shirt was missing a sleeve.\nWhat no one tells is what came after.\nAurel was nineteen now, and he had learned to button a coat with one hand. He had learned to keep the wing folded tight beneath his cloak in the market, so the children would not stare. He had learned to smile when his brothers spoke of the curse as something finished.\nBut on autumn nights, when the wild geese passed over the castle calling to one another, the wing ached and stretched and would not be still. And tonight, for the first time, something in the sky called back to him by name.',
  },
  {
    title: 'Saturday at the Suds & Spin',
    author: 'NovelWriter',
    description: 'A neighborhood laundromat, one long Saturday, and the small lives that pass through it.',
    tags: ['slice-of-life', 'comedy'],
    mode: 'storyteller',
    memory: 'The Suds & Spin is a 24-hour laundromat on a busy corner. Dolores, sixty-eight, has worked the counter for twenty years and knows everyone\'s business. Machine number nine has a mind of its own.',
    authorsNote: '[ Style: gentle humor, ensemble cast, observational ]',
    prompt:
      'At 7:02 on Saturday morning, Dolores unlocked the Suds & Spin, flipped the sign, and said good morning to machine number nine, because experience had taught her it went better that way.\nThe first customer was the young man from the apartment upstairs, who came in every week with a single enormous bag and the haunted look of someone who had once again forgotten to separate his colors. Behind him came the Hendersons\' twins, arguing about whose turn it was to hold the detergent, and their father, who looked like he had not slept since they were born.\nDolores poured herself coffee from the pot behind the counter and settled onto her stool to watch. Saturdays always had a story in them. She just never knew, at 7:02, which one it would be.',
  },
  {
    title: 'The Glass Vault of Merrow',
    author: 'NovelWriter',
    description: 'Assemble a crew, plan the impossible, and rob the most secure vault in a city built on canals.',
    tags: ['heist', 'fantasy', 'crime'],
    mode: 'storyteller',
    memory: 'Merrow is a canal city ruled by merchant houses. The Glass Vault beneath the Exchange is warded by alchemical locks and watched by clockwork sentries. ${leader[Corin Ashe]} leads a crew of thieves: Pell, a forger; Isolde, a lockbreaker; and Grub, a very large man who mostly lifts things.',
    authorsNote: '[ Style: snappy, clever, fast-paced heist ]',
    prompt:
      '${leader[Corin Ashe]} spread the stolen blueprints across the table in the back room of the Drowned Rat and pinned the corners with four mugs of bad ale.\n"Three hundred years," Corin said. "Three hundred years the Glass Vault has stood under the Exchange, and nobody has ever walked out with so much as a copper. Alchemical locks. Clockwork sentries. A floor that sings if you put a foot wrong."\nPell raised an eyebrow. "You\'re not selling it well."\n"I\'m not selling it. I\'m telling you why nobody will expect us." Corin tapped a small square on the plan, deep in the lowest level. "In nine days, House Varn moves the Sunstone into that room for the Founders\' Festival. And on the night of the festival, every guard in the city will be watching the fireworks."',
    placeholders: [{ key: 'leader', defaultValue: 'Corin Ashe', description: "The crew leader's name" }],
  },
  {
    title: 'The Ferryman\'s Bargain',
    author: 'NovelWriter',
    description: 'Cross the river between the living and the dead to bargain for the return of someone you lost.',
    tags: ['mythic', 'folklore', 'adventure'],
    mode: 'adventure',
    memory: 'You have walked to the edge of the world to reach the Grey River, which divides the living lands from the Hollow Country of the dead. The Ferryman accepts no coin, only things that cannot be bought: a memory, a name, a year of life.',
    authorsNote: '[ Style: mythic, dreamlike, solemn ]',
    prompt:
      'The road ends where the grass turns to ash. Ahead, the Grey River slides past without a sound, so wide that its far bank is only a rumor of shadow. Mist rises from it in slow, patient coils.\nA long black boat waits at the water\'s edge. In its stern stands a tall figure in a cloak the color of riverstone, holding a pole of pale wood. Its face is hidden, but you feel its attention settle on you like frost.\n> You step forward and ask the Ferryman to carry you across.\n"Many ask," the Ferryman says, and its voice is like water moving over stones. "Few can pay. I do not take silver, living one. Tell me what you have brought me, and tell me who you seek on the other side."',
  },
  {
    title: 'Goblin Tax Season',
    author: 'NovelWriter',
    description: 'You are the newest, most junior tax collector in the Kingdom. Your first assignment: the goblin warrens.',
    tags: ['comedy', 'fantasy', 'adventure'],
    mode: 'adventure',
    memory: 'You are ${name[Pip Fennimore]}, a junior assessor for the Royal Office of Levies and Tithes. Goblins love paperwork, hate paying, and are extremely litigious. Your only equipment is a clipboard, a quill, and a very official hat.',
    authorsNote: '[ Style: absurd, lighthearted comedy ]',
    prompt:
      'Your supervisor handed you the file with the expression of a man passing on a cursed amulet. "The Gnashrock Warrens," he said. "Nobody has collected from them in forty years. Good luck, ${name[Pip Fennimore]}. Do not, under any circumstances, accept their tea."\nNow you stand at the mouth of a cave decorated with a large hand-painted sign that reads NO TAXMEN, and beneath it, in smaller letters, ALSO NO SALESMEN, BARDS, OR GERALD.\n> You straighten your official hat and knock on the cave wall.\nA hatch slides open at knee height. A pair of yellow eyes peers out, narrows at your clipboard, and widens with something that looks alarmingly like delight. "Oh," says the goblin. "Oh, a FORM person. Come in, come in. Would you like some tea?"',
    placeholders: [{ key: 'name', defaultValue: 'Pip Fennimore', description: 'Your name' }],
  },
];
