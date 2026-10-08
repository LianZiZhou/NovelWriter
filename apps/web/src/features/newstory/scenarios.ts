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
];
