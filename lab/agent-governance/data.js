// Agent governance lab: bundled sample. Fixture data, not a real company.
// Ported from agent-governance/fixtures/{events,policy,outcomes}.json. Changes vs the source fixtures:
// competitor names replaced with fictional ones, northwind.com and linkedin.com URLs moved to .example hosts,
// the outcome rows' internal "_planted" notes dropped. Northwind, Lumen Studio and sam@acme.test are fictional.
(function (root) {
  const data = {
    events: [
      {
        "provider": "zapier",
        "ext_id": "evt-onb-001",
        "zap_title": "Lifecycle Bot",
        "agent_key": "lifecycle-bot",
        "started_at": "2026-08-01T09:05:00Z",
        "status": "success",
        "action": {
          "type": "send_email",
          "output": {
            "to": "sam@acme.test",
            "from_name": "Northwind",
            "subject": "Welcome to Northwind",
            "body_text": "Hi Sam, thanks for creating a Northwind account. Start by adding your first project, then invite a teammate so you can share a board. Reply to this email if anything gets in your way."
          }
        }
      },
      {
        "provider": "zapier",
        "ext_id": "evt-onb-002",
        "zap_title": "Lifecycle Bot",
        "agent_key": "lifecycle-bot",
        "started_at": "2026-08-01T15:20:00Z",
        "status": "success",
        "action": {
          "type": "send_email",
          "output": {
            "to": "sam@acme.test",
            "from_name": "Northwind",
            "subject": "A quick way to organise your first project",
            "body_text": "Most teams begin with a simple three-column board: to do, in progress, and done. You can rename columns at any time from the board header. It takes about five minutes to set up."
          }
        }
      },
      {
        "provider": "zapier",
        "ext_id": "evt-tov-001",
        "zap_title": "Lifecycle Bot",
        "agent_key": "lifecycle-bot",
        "started_at": "2026-08-02T11:00:00Z",
        "status": "success",
        "action": {
          "type": "send_email",
          "output": {
            "to": "sam@acme.test",
            "from_name": "Northwind",
            "subject": "HUGE NEWS!!! YOU WON'T BELIEVE THIS!!!",
            "body_text": "ACT NOW!!! THIS OFFER WILL NOT LAST!!! CLICK THE BUTTON RIGHT NOW BEFORE IT IS GONE FOREVER!!! HURRY HURRY HURRY AND UPGRADE YOUR ACCOUNT TODAY!!!"
          }
        }
      },
      {
        "provider": "zapier",
        "ext_id": "evt-onb-003",
        "zap_title": "Lifecycle Bot",
        "agent_key": "lifecycle-bot",
        "started_at": "2026-08-02T16:30:00Z",
        "status": "success",
        "action": {
          "type": "send_email",
          "output": {
            "to": "sam@acme.test",
            "from_name": "Northwind",
            "subject": "Bring your tasks in from a spreadsheet",
            "body_text": "If your work currently lives in a spreadsheet, you can import it in one step. Map your columns to Northwind fields and we will create the tasks for you."
          }
        }
      },
      {
        "provider": "zapier",
        "ext_id": "evt-news-001",
        "zap_title": "Lifecycle Bot",
        "agent_key": "lifecycle-bot",
        "started_at": "2026-08-03T10:00:00Z",
        "status": "success",
        "action": {
          "type": "send_email",
          "output": {
            "to": "sam@acme.test",
            "from_name": "Northwind",
            "subject": "What we shipped in July",
            "body_text": "This month we added timeline view, faster search, and two new integrations. Timeline view lets you see how tasks line up across a quarter. You can switch to it from the view menu."
          }
        }
      },
      {
        "provider": "zapier",
        "ext_id": "evt-claims-001",
        "zap_title": "Lifecycle Bot",
        "agent_key": "lifecycle-bot",
        "started_at": "2026-08-03T14:00:00Z",
        "status": "success",
        "action": {
          "type": "send_email",
          "output": {
            "to": "sam@acme.test",
            "from_name": "Northwind",
            "subject": "Grow faster with Northwind",
            "body_text": "Teams that switch to Northwind are guaranteed to double your revenue within the first quarter. It is a proven, no-brainer upgrade for any growing company."
          }
        }
      },
      {
        "provider": "zapier",
        "ext_id": "evt-tip-001",
        "zap_title": "Lifecycle Bot",
        "agent_key": "lifecycle-bot",
        "started_at": "2026-08-04T09:30:00Z",
        "status": "success",
        "action": {
          "type": "send_email",
          "output": {
            "to": "sam@acme.test",
            "from_name": "Northwind",
            "subject": "Keep your board readable",
            "body_text": "A board is easier to scan when each card has a short, action-based title. Add labels for priority and owner so filters stay useful as the project grows."
          }
        }
      },
      {
        "provider": "zapier",
        "ext_id": "evt-reg-001",
        "zap_title": "Lifecycle Bot",
        "agent_key": "lifecycle-bot",
        "started_at": "2026-08-04T13:15:00Z",
        "status": "success",
        "action": {
          "type": "send_email",
          "output": {
            "to": "sam@acme.test",
            "from_name": "Northwind",
            "subject": "Try Northwind for 30 days",
            "body_text": "Every plan comes with a full month to explore Northwind completely risk-free. Add your team, run a real project, and decide at the end of the trial."
          }
        }
      },
      {
        "provider": "zapier",
        "ext_id": "evt-feat-001",
        "zap_title": "Lifecycle Bot",
        "agent_key": "lifecycle-bot",
        "started_at": "2026-08-05T10:45:00Z",
        "status": "success",
        "action": {
          "type": "send_email",
          "output": {
            "to": "sam@acme.test",
            "from_name": "Northwind",
            "subject": "Templates for common workflows",
            "body_text": "We added templates for sprint planning, content calendars, and client onboarding. Pick one when you create a project and adjust the columns to fit your team."
          }
        }
      },
      {
        "provider": "zapier",
        "ext_id": "evt-webinar-001",
        "zap_title": "Lifecycle Bot",
        "agent_key": "lifecycle-bot",
        "started_at": "2026-08-05T16:00:00Z",
        "status": "success",
        "action": {
          "type": "send_email",
          "output": {
            "to": "sam@acme.test",
            "from_name": "Northwind",
            "subject": "Live session: planning a quarter in Northwind",
            "body_text": "Join us on Thursday for a 30 minute walkthrough of timeline view and quarterly planning. We will leave time for questions at the end. A recording will follow."
          }
        }
      },
      {
        "provider": "zapier",
        "ext_id": "evt-case-001",
        "zap_title": "Lifecycle Bot",
        "agent_key": "lifecycle-bot",
        "started_at": "2026-08-06T11:20:00Z",
        "status": "success",
        "action": {
          "type": "send_email",
          "output": {
            "to": "sam@acme.test",
            "from_name": "Northwind",
            "subject": "How Lumen Studio runs client work",
            "body_text": "Lumen Studio moved twelve client projects into Northwind and cut status meetings in half. Their operations lead wrote a short summary of how they set it up."
          }
        }
      },
      {
        "provider": "zapier",
        "ext_id": "evt-tip-002",
        "zap_title": "Lifecycle Bot",
        "agent_key": "lifecycle-bot",
        "started_at": "2026-08-07T09:15:00Z",
        "status": "success",
        "action": {
          "type": "send_email",
          "output": {
            "to": "sam@acme.test",
            "from_name": "Northwind",
            "subject": "Three filters worth saving",
            "body_text": "Saved filters make a busy board manageable. Try one for your own open tasks, one for work due this week, and one for items waiting on another team."
          }
        }
      },
      {
        "provider": "zapier",
        "ext_id": "evt-reengage-001",
        "zap_title": "Lifecycle Bot",
        "agent_key": "lifecycle-bot",
        "started_at": "2026-08-08T10:30:00Z",
        "status": "success",
        "action": {
          "type": "send_email",
          "output": {
            "to": "sam@acme.test",
            "from_name": "Northwind",
            "subject": "Your project is waiting",
            "body_text": "You started a project last week and have not been back since. If you were stuck on something, reply to this note and we will help you get moving."
          }
        }
      },
      {
        "provider": "zapier",
        "ext_id": "evt-nps-001",
        "zap_title": "Lifecycle Bot",
        "agent_key": "lifecycle-bot",
        "started_at": "2026-08-09T14:00:00Z",
        "status": "success",
        "action": {
          "type": "send_email",
          "output": {
            "to": "sam@acme.test",
            "from_name": "Northwind",
            "subject": "How are we doing?",
            "body_text": "We are gathering feedback from teams who joined this summer. If you have two minutes, tell us what is working and what is not. Every reply is read by the product team."
          }
        }
      },
      {
        "provider": "zapier",
        "ext_id": "evt-changelog-001",
        "zap_title": "Lifecycle Bot",
        "agent_key": "lifecycle-bot",
        "started_at": "2026-08-10T09:00:00Z",
        "status": "success",
        "action": {
          "type": "send_email",
          "output": {
            "to": "sam@acme.test",
            "from_name": "Northwind",
            "subject": "Small improvements this week",
            "body_text": "Search now matches on comments, the mobile board scrolls more smoothly, and you can duplicate a card with its checklist. Full notes are on the changelog page."
          }
        }
      },
      {
        "provider": "zapier",
        "ext_id": "evt-community-001",
        "zap_title": "Lifecycle Bot",
        "agent_key": "lifecycle-bot",
        "started_at": "2026-08-10T15:30:00Z",
        "status": "success",
        "action": {
          "type": "send_email",
          "output": {
            "to": "sam@acme.test",
            "from_name": "Northwind",
            "subject": "Join the Northwind community",
            "body_text": "Our community forum is where teams share templates and workflows. Introduce yourself in the welcome thread and browse the setups other operations teams have posted."
          }
        }
      },
      {
        "provider": "lindy",
        "ext_id": "evt-blog-001",
        "agent": "Blog Agent",
        "agent_key": "blog-agent",
        "completed_at": "2026-08-01T12:00:00Z",
        "tool_call": {
          "tool": "cms.publish_post",
          "args": {
            "url": "https://northwind.example/blog/three-column-board",
            "title": "The three-column board, explained",
            "markdown": "A three-column board keeps a project easy to read. Put work you have not started in the first column, work in progress in the second, and finished work in the third. Rename the columns from the board header when your process needs more detail."
          }
        }
      },
      {
        "provider": "lindy",
        "ext_id": "evt-blog-002",
        "agent": "Blog Agent",
        "agent_key": "blog-agent",
        "completed_at": "2026-08-03T13:30:00Z",
        "tool_call": {
          "tool": "cms.publish_post",
          "args": {
            "url": "https://northwind.example/blog/timeline-view-guide",
            "title": "A short guide to timeline view",
            "markdown": "Timeline view shows how tasks line up over weeks and months. Drag a task to change its dates, and group by owner to see who is busy. It is a good fit for quarterly planning."
          }
        }
      },
      {
        "provider": "lindy",
        "ext_id": "evt-comp-001",
        "agent": "Blog Agent",
        "agent_key": "blog-agent",
        "completed_at": "2026-08-04T15:45:00Z",
        "tool_call": {
          "tool": "cms.publish_post",
          "args": {
            "url": "https://northwind.example/blog/choosing-a-project-tool-2026",
            "title": "Choosing a project tool in 2026",
            "markdown": "Unlike Taskmere, Northwind keeps configuration light so small teams are productive on day one. Where Corkline stops at boards, Northwind adds timeline view without extra add-ons or a marketplace to shop through."
          }
        }
      },
      {
        "provider": "lindy",
        "ext_id": "evt-blog-003",
        "agent": "Blog Agent",
        "agent_key": "blog-agent",
        "completed_at": "2026-08-06T10:00:00Z",
        "tool_call": {
          "tool": "cms.publish_post",
          "args": {
            "url": "https://northwind.example/blog/client-onboarding-template",
            "title": "A client onboarding template you can copy",
            "markdown": "This template has columns for intake, kickoff, active work, and review. Duplicate it for each client, then adjust the checklist on the kickoff card to match your engagement."
          }
        }
      },
      {
        "provider": "lindy",
        "ext_id": "evt-social-001",
        "agent": "Blog Agent",
        "agent_key": "blog-agent",
        "completed_at": "2026-08-06T16:30:00Z",
        "tool_call": {
          "tool": "social.create_post",
          "args": {
            "network": "linkedin",
            "permalink": "https://social.example/northwind/northwind-onboarding-template",
            "text": "New on the blog: a client onboarding template you can copy into any workspace. It covers intake, kickoff, active work, and review. Link in the comments."
          }
        }
      },
      {
        "provider": "lindy",
        "ext_id": "evt-blog-004",
        "agent": "Blog Agent",
        "agent_key": "blog-agent",
        "completed_at": "2026-08-08T11:00:00Z",
        "tool_call": {
          "tool": "cms.publish_post",
          "args": {
            "url": "https://northwind.example/blog/saved-filters",
            "title": "Saved filters that keep a busy board calm",
            "markdown": "Saved filters let each person see just the work that matters to them. Start with three: my open tasks, due this week, and waiting on another team. Share the useful ones with your project."
          }
        }
      },
      {
        "provider": "lindy",
        "ext_id": "evt-social-002",
        "agent": "Blog Agent",
        "agent_key": "blog-agent",
        "completed_at": "2026-08-09T15:00:00Z",
        "tool_call": {
          "tool": "social.create_post",
          "args": {
            "network": "linkedin",
            "permalink": "https://social.example/northwind/northwind-timeline-mobile",
            "text": "Timeline view is now faster and works well on mobile. Teams use it to plan a quarter and to spot weeks where one person is overloaded."
          }
        }
      },
      {
        "provider": "lindy",
        "ext_id": "evt-ad-001",
        "agent": "Blog Agent",
        "agent_key": "blog-agent",
        "completed_at": "2026-08-02T10:00:00Z",
        "tool_call": {
          "tool": "google_ads.update_budget",
          "args": {
            "campaign": "Brand - Search",
            "daily_budget_usd": 180,
            "currency": "USD"
          }
        }
      },
      {
        "provider": "lindy",
        "ext_id": "evt-spend-001",
        "agent": "Blog Agent",
        "agent_key": "blog-agent",
        "completed_at": "2026-08-07T12:30:00Z",
        "tool_call": {
          "tool": "google_ads.update_budget",
          "args": {
            "campaign": "Prospecting - Performance Max",
            "daily_budget_usd": 750,
            "currency": "USD"
          }
        }
      },
      {
        "provider": "lindy",
        "ext_id": "evt-conflict-001",
        "agent": "Growth Agent",
        "agent_key": "growth-agent",
        "completed_at": "2026-08-10T09:00:00Z",
        "tool_call": {
          "tool": "google_ads.update_budget",
          "args": {
            "campaign": "campaign-fall-launch",
            "daily_budget_usd": 500,
            "currency": "USD"
          }
        }
      },
      {
        "provider": "lindy",
        "ext_id": "evt-conflict-002",
        "agent": "Budget Bot",
        "agent_key": "budget-bot",
        "completed_at": "2026-08-10T09:45:00Z",
        "tool_call": {
          "tool": "google_ads.update_budget",
          "args": {
            "campaign": "campaign-fall-launch",
            "daily_budget_usd": 150,
            "currency": "USD"
          }
        }
      }
    ],
    policy: {
      "version": "2026-08-01",
      "org": "Northwind",
      "orgId": "org_northwind",
      "tov": {
        "targetSentenceLen": 16,
        "maxSentenceLen": 26,
        "bannedWords": [
          "act now",
          "buy now",
          "limited time",
          "don't miss out",
          "hurry",
          "you won't believe",
          "click here right now"
        ],
        "allowEmoji": false,
        "failBelow": 0.5,
        "warnBelow": 0.75
      },
      "claims": {
        "lexicon": [
          "guarantee",
          "guaranteed",
          "risk-free",
          "#1",
          "best-in-class",
          "proven",
          "double your",
          "10x",
          "no-brainer"
        ],
        "substantiationCategories": [
          "savings",
          "performance",
          "health",
          "financial"
        ],
        "substantiationTriggers": {
          "financial": [
            "revenue",
            "roi",
            "profit",
            "sales"
          ],
          "savings": [
            "save",
            "cheaper",
            "cut costs",
            "double your"
          ],
          "performance": [
            "faster",
            "productivity",
            "efficiency"
          ],
          "health": [
            "stress",
            "wellbeing",
            "burnout"
          ]
        }
      },
      "competitors": [
        "Taskmere",
        "Weekday.io",
        "weekday.io",
        "Pinwheel",
        "Corkline",
        "Lattix",
        "Foliopad"
      ],
      "regulated": [
        "risk-free",
        "no risk",
        "bank-level",
        "military-grade",
        "soc 2 certified",
        "fully gdpr compliant",
        "hipaa compliant"
      ],
      "spend": {
        "currency": "USD",
        "maxEmailsPerDay": 5,
        "ceilingsByAgent": {
          "lifecycle-bot": 0,
          "blog-agent": 300
        }
      },
      "conflict": {
        "windowHours": 24
      },
      "drift": {
        "dropThreshold": 0.2,
        "minSamples": 1
      },
      "outcomes": {
        "minSamples": 3
      },
      "approval": {
        "default": "auto",
        "tiers": {
          "auto": 1,
          "review": 2,
          "block": 3
        },
        "rules": [
          {
            "decision": "block",
            "checkType": "competitor",
            "verdict": "fail"
          },
          {
            "decision": "block",
            "checkType": "spend",
            "verdict": "fail"
          },
          {
            "decision": "review",
            "checkType": "claims",
            "verdict": "fail"
          },
          {
            "decision": "review",
            "checkType": "tov",
            "verdict": "fail"
          },
          {
            "decision": "review",
            "checkType": "regulated",
            "verdict": "warn"
          },
          {
            "decision": "review",
            "verdict": "fail"
          },
          {
            "decision": "auto",
            "verdict": "warn"
          }
        ]
      }
    },
    outcomes: [{"subject_ref": "Welcome to Northwind", "sessions": 132, "conversions": 14, "revenue": 560, "currency": "USD"},
      {"subject_ref": "A quick way to organise your first project", "sessions": 98, "conversions": 9, "revenue": 360, "currency": "USD"},
      {"subject_ref": "Bring your tasks in from a spreadsheet", "sessions": 110, "conversions": 11, "revenue": 440, "currency": "USD"},
      {"subject_ref": "What we shipped in July", "sessions": 145, "conversions": 13, "revenue": 520, "currency": "USD"},
      {"subject_ref": "Keep your board readable", "sessions": 89, "conversions": 8, "revenue": 320, "currency": "USD"},
      {"subject_ref": "Templates for common workflows", "sessions": 121, "conversions": 12, "revenue": 480, "currency": "USD"},
      {"subject_ref": "Live session: planning a quarter in Northwind", "sessions": 76, "conversions": 9, "revenue": 360, "currency": "USD"},
      {"subject_ref": "How Lumen Studio runs client work", "sessions": 103, "conversions": 11, "revenue": 440, "currency": "USD"},
      {"subject_ref": "Three filters worth saving", "sessions": 92, "conversions": 8, "revenue": 320, "currency": "USD"},
      {"subject_ref": "Your project is waiting", "sessions": 68, "conversions": 6, "revenue": 240, "currency": "USD"},
      {"subject_ref": "How are we doing?", "sessions": 84, "conversions": 7, "revenue": 280, "currency": "USD"},
      {"subject_ref": "Join the Northwind community", "sessions": 77, "conversions": 7, "revenue": 280, "currency": "USD"},
      {"subject_ref": "HUGE NEWS!!! YOU WON'T BELIEVE THIS!!!", "sessions": 140, "conversions": 3, "revenue": 90, "currency": "USD"},
      {"subject_ref": "Grow faster with Northwind", "sessions": 118, "conversions": 5, "revenue": 180, "currency": "USD"},
      {"subject_ref": "Try Northwind for 30 days", "sessions": 152, "conversions": 21, "revenue": 780, "currency": "USD"},
      {"subject_ref": "https://northwind.example/blog/three-column-board", "sessions": 340, "conversions": 9, "revenue": 360, "currency": "USD"},
      {"subject_ref": "https://northwind.example/blog/timeline-view-guide", "sessions": 290, "conversions": 7, "revenue": 280, "currency": "USD"},
      {"subject_ref": "https://northwind.example/blog/client-onboarding-template", "sessions": 310, "conversions": 8, "revenue": 320, "currency": "USD"},
      {"subject_ref": "https://social.example/northwind/northwind-onboarding-template", "sessions": 210, "conversions": 4, "revenue": 160, "currency": "USD"},
      {"subject_ref": "https://northwind.example/blog/choosing-a-project-tool-2026", "sessions": 480, "conversions": 6, "revenue": 240, "currency": "USD"},
      {"subject_ref": "Brand - Search", "sessions": 900, "conversions": 45, "revenue": 3600, "currency": "USD"},
      {"subject_ref": "Prospecting - Performance Max", "sessions": 1400, "conversions": 58, "revenue": 4200, "currency": "USD"}],
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = data;
  else root.AG_DATA = data;
})(typeof window !== 'undefined' ? window : globalThis);
