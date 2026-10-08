{
  "storyContainerVersion": 1,
  "metadata": {
    "storyMetadataVersion": 1,
    "id": "adecba26-5e5e-4d9f-8248-137cc9986fe3",
    "title": "New Story",
    "description": "",
    "textPreview": "You stand at the cave mouth.",
    "isTA": true,
    "favorite": false,
    "tags": [],
    "createdAt": 1791479530449,
    "lastUpdatedAt": 1791479541433,
    "isModified": true,
    "hasDocument": true
  },
  "content": {
    "storyContentVersion": 7,
    "settings": {
      "parameters": {
        "textGenerationSettingsVersion": 8,
        "temperature": 1,
        "max_length": 512,
        "min_length": 1,
        "top_k": 40,
        "top_p": 0.95,
        "top_a": 1,
        "typical_p": 1,
        "tail_free_sampling": 1,
        "repetition_penalty": 0,
        "repetition_penalty_range": 0,
        "repetition_penalty_slope": 0,
        "repetition_penalty_frequency": 0,
        "repetition_penalty_presence": 0,
        "repetition_penalty_default_whitelist": false,
        "cfg_scale": 1,
        "cfg_uc": "",
        "phrase_rep_pen": "medium",
        "top_g": 0,
        "mirostat_tau": 0,
        "mirostat_lr": 1,
        "math1_temp": 0,
        "math1_quad": 0,
        "math1_quad_entropy_scale": 0,
        "min_p": 0,
        "order": [
          {
            "id": "temperature",
            "enabled": true
          },
          {
            "id": "top_k",
            "enabled": true
          },
          {
            "id": "top_p",
            "enabled": true
          },
          {
            "id": "min_p",
            "enabled": false
          }
        ]
      },
      "preset": "default-glm",
      "trimResponses": true,
      "banBrackets": true,
      "defaultBias": true,
      "prefix": "vanilla",
      "dynamicPenaltyRange": false,
      "prefixMode": 0,
      "mode": 1,
      "model": "glm-4-6"
    },
    "document": "1BQA1HJAlahzZWN0aW9uc6VvcmRlcqdoaXN0b3J5rWRpcnR5U2VjdGlvbnOkc3RlcICQ1B4A1HJBk6Ryb290p2N1cnJlbnSlbm9kZXPLQvJgJ8fNgIDLQvAsHbOn6hCCy0LyYCfHzYCA1B8A1HJCl6JpZKZwYXJlbnSoY2hpbGRyZW6lcm91dGWnY2hhbmdlc6RkYXRlq2dlblBvc2l0aW9uy0LyYCfHzYCA1AAA1HMAkctC8Cwds6fqENQAAIDX/2sMyQBqx87q1AAAy0LwLB2zp+oQ1B8AQstC8Cwds6fqEMtC8mAnx82AgNRzAJDUAACA1/+2Y+UAasfO9NQAAIHLQsyprG4JCgDUckOTpHR5cGWnc2VjdGlvbqVhZnRlcgDUckSUpHR5cGWkdGV4dKRtZXRhpnNvdXJjZQG8WW91IHN0YW5kIGF0IHRoZSBjYXZlIG1vdXRoLoIBkdRyRZOocG9zaXRpb26kZGF0YaZsZW5ndGgAChwCkNQAAAAA",
    "context": [
      {
        "text": "",
        "contextConfig": {
          "prefix": "",
          "suffix": "\n",
          "tokenBudget": 1,
          "reservedTokens": 0,
          "budgetPriority": 800,
          "trimDirection": "trimBottom",
          "insertionType": "newline",
          "maximumTrimType": "sentence",
          "insertionPosition": 0
        }
      },
      {
        "text": "",
        "contextConfig": {
          "prefix": "",
          "suffix": "\n",
          "tokenBudget": 1,
          "reservedTokens": 1,
          "budgetPriority": -400,
          "trimDirection": "trimBottom",
          "insertionType": "newline",
          "maximumTrimType": "sentence",
          "insertionPosition": -4
        }
      }
    ],
    "lorebook": {
      "lorebookVersion": 6,
      "entries": [],
      "settings": {
        "orderByKeyLocations": false
      },
      "categories": [],
      "order": []
    },
    "storyContextConfig": {
      "prefix": "",
      "suffix": "",
      "tokenBudget": 1,
      "reservedTokens": 512,
      "budgetPriority": 0,
      "trimDirection": "trimTop",
      "insertionType": "newline",
      "maximumTrimType": "sentence",
      "insertionPosition": -1,
      "allowInsertionInside": true
    },
    "ephemeralContext": [],
    "contextDefaults": {
      "ephemeralDefaults": [
        {
          "text": "",
          "contextConfig": {
            "prefix": "",
            "suffix": "\n",
            "tokenBudget": 1,
            "reservedTokens": 1,
            "budgetPriority": -10000,
            "trimDirection": "doNotTrim",
            "insertionType": "newline",
            "maximumTrimType": "newline",
            "insertionPosition": -2
          },
          "startingStep": 1,
          "delay": 0,
          "duration": 1,
          "repeat": false,
          "reverse": false
        }
      ],
      "loreDefaults": [
        {
          "text": "",
          "contextConfig": {
            "prefix": "",
            "suffix": "\n",
            "tokenBudget": 1,
            "reservedTokens": 0,
            "budgetPriority": 400,
            "trimDirection": "trimBottom",
            "insertionType": "newline",
            "maximumTrimType": "sentence",
            "insertionPosition": -1
          },
          "lastUpdatedAt": 1791479530449,
          "displayName": "New Lorebook Entry",
          "id": "e9815c0f-811d-4412-a00a-cd53cd80b238",
          "keys": [],
          "searchRange": 1000,
          "enabled": true,
          "forceActivation": false,
          "keyRelative": false,
          "nonStoryActivatable": false,
          "category": "",
          "loreBiasGroups": [
            {
              "phrases": [],
              "ensureSequenceFinish": false,
              "generateOnce": true,
              "bias": 0,
              "enabled": true,
              "whenInactive": false
            }
          ],
          "advancedConditions": []
        }
      ]
    },
    "settingsDirty": false,
    "phraseBiasGroups": [
      {
        "phrases": [],
        "ensureSequenceFinish": false,
        "generateOnce": true,
        "bias": 0,
        "enabled": true,
        "whenInactive": false
      }
    ],
    "bannedSequenceGroups": [
      {
        "sequences": [],
        "enabled": true
      }
    ],
    "messageSettings": {
      "systemPrompts": {},
      "prefills": {}
    },
    "sideChats": [],
    "userScripts": [],
    "scriptStorage": {
      "storyStorage": {},
      "historyStorage": {}
    },
    "attg": {
      "tags": [],
      "genre": []
    }
  }
}