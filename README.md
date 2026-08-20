# Life Quest RPG

BUILD THE COMPLETE PERSONAL LIFE RPG

1. PROJECT IDENTITY

Build a complete, polished, mobile-first Personal Life RPG and Adaptive Behavior-Change System.

This is a private personal application for one user.

It is NOT a SaaS product.

It is NOT a social network.

It is NOT a commercial multi-user productivity platform.

It is NOT a simple habit tracker.

The purpose is to help the user transform:

passive behavior

procrastination

unwanted habits

excessive unplanned entertainment

lack of activity

lack of motivation

into:

useful habits

physical activity

learning

productive work

hobbies

exploration

consistency

healthier routines

meaningful progress

The application should make real-world improvement feel like a highly customizable game.

2. MOST IMPORTANT PRINCIPLE

THE APP IS A LAUNCHPAD FOR REAL LIFE

The application must NOT optimize for keeping the user inside the application.

The desired loop is:

Current State
→ Next Move
→ Real-World Action
→ Put Device Away
→ Complete Activity
→ Verify / Record
→ Reward
→ Progress
→ Learn
→ Adapt
→ Return to Real Life

The app should make the user think:

"I know what to do next. Let's go."

not:

"I should spend more time inside the app."

3. PRODUCT PERSONALITY

Make the application feel:

exciting

energetic

premium

game-like

responsive

personal

motivating

adventurous

customizable

intelligent

adaptive

Avoid the appearance of:

spreadsheet

generic productivity software

boring habit tracker

corporate dashboard

Use polished:

cards

progress bars

quest panels

rank displays

achievement animations

visual progression

subtle sound/animation hooks

clear calls to action

mobile-friendly interactions

Do not create excessive animations that slow the user down.

4. CORE GAME VOCABULARY

Use these terms throughout the UI.

NormalApp terminologyXP / PointsSparks ⚡LevelRank 🏆Good HabitBoost ⚡Unwanted HabitDrain 🕳️TaskQuest ⚔️GoalDestination 🗺️StreakRun 🔥Current stateMomentum 🌊RecommendationNext Move ⚡RewardLoot 🎁Reward StoreVault 🗝️AchievementTrophy 🏆ChallengeTrial ⚔️Random ChallengeWildcard 🎲Large GoalBoss 👑Recovery PlanRecovery 🛟Long-term PhaseChapter 📖ReflectionDebrief 📝AnalyticsLife Intel 🧠Consecutive actionsCombo 🔥High-energy periodSurge ⚡Character/ProfileIdentity

All names must be configurable later.

5. MAIN APP NAVIGATION

Create a polished mobile-first navigation containing:

Home

Next Move

Quests

Journey

Chat

Life Intel

Identity

Settings

Additional screens should be accessible through appropriate navigation:

Destinations

Boosts

Drains

Battles

Bosses

Trials

Trophies

Vault

Experiments

Recovery

Activity History

AI Control Center

Personal Blueprint

Sync / Backup

6. HOME SCREEN

The Home screen should feel like a game dashboard.

Display:

current Rank

total Sparks

Momentum

current Run

best Run

current Chapter

active Destinations

today's Battle

quest progress

Next Move

Wildcard

Recovery when appropriate

Primary button:

⚡ NEXT MOVE

Secondary actions:

Start Quest

Wildcard

View Battle

View Journey

Chat

7. NEXT MOVE SYSTEM

The Next Move screen must be one of the most important screens in the app.

Show 3–5 options.

Example:

⚡ RECOMMENDED

15-minute walk

🎯 PRODUCTIVE

20-minute focus session

🧠 LEARN

15-minute learning activity

🎨 CREATE

Work on a hobby

🛟 RECOVERY

5-minute reset

🎲 WILDCARD

Surprise me

Every recommendation must include:

title

estimated duration

reason

reward

related Attribute

related Destination

difficulty

Do not force the user to accept the first option.

8. PERSONAL CURRENT STATE

Create a lightweight Current State system.

Possible inputs:

energy

mood

available time

current Momentum

recent activity

current priorities

recent failures

recent successes

The UI should make this fast to update.

The app should never require a long form before generating a Next Move.

9. QUEST SYSTEM

Create a complete Quest system.

Quest types:

Quick Quest

5–10 minutes

Normal Quest

10–30 minutes

Focus Quest

20–60 minutes

Rush Quest

Short start window

Epic Quest

Large activity

Wildcard

Unexpected activity

Trial

Multi-day challenge

Boss

Long-term objective

Each Quest should support:

name

description

category

duration

difficulty

Sparks

Attribute rewards

Destination

schedule

status

verification

created_by

AI_generated flag

approved flag

10. RUSH SYSTEM

Create an optional Rush mechanic.

Example:

RUSH QUEST

"Start within 60 seconds."

Display a countdown.

When the user starts:

GO.

Then minimize the UI so the real-world activity becomes the focus.

Do not punish the user severely if the Rush is missed.

A missed Rush becomes data that can be analyzed.

11. COMBO SYSTEM

Completing meaningful activities consecutively can create Combos.

Example:

Quest 1:
Combo x1

Quest 2:
Combo x2

Quest 3:
Combo x3

At selected thresholds:

MOMENTUM SURGE

Give bonus Sparks.

Only meaningful activity should count.

Do not allow the user to farm Combos by repeatedly pressing UI buttons.

12. MOMENTUM

Momentum is a dynamic state representing recent real-world activity.

Momentum may consider:

recent completed actions

consistency

difficulty

recent misses

time since last meaningful action

current activity

energy

behavior patterns

The exact calculation must be deterministic.

Do not let the LLM directly calculate Momentum.

13. RANK / SPARKS

Sparks are the core progression currency.

The deterministic engine calculates:

Sparks awarded

Rank

Rank progression

bonuses

penalties if configured

milestone rewards

Example:

Walking:

+25 Sparks

Study:

+40 Sparks

Project:

+50 Sparks

Use configurable values.

Do not hard-code all reward numbers permanently.

14. BOOST SYSTEM

A Boost is a positive behavior.

Each Boost supports:

name

icon

category

difficulty

duration

frequency

Spark reward

Attribute reward

preferred time

minimum version

replacement relation to Drains

Examples:

walking

studying

reading

exercise

outdoor activity

cleaning

creative work

project work

learning

15. DRAIN SYSTEM

A Drain represents an unwanted pattern.

Never label the user as "bad" because of a Drain.

Each Drain can store:

name

trigger

frequency

context

typical time

intensity

consequence

replacement

counter-move

Example:

Drain:
Long unplanned gaming

Trigger:
Boredom

Counter:
5-minute Boost

The system uses:

Trigger
→ Interrupt
→ Replacement
→ Reinforcement
→ Repetition

16. MISSED QUEST FLOW

If the user does not complete a Quest:

DO NOT simply display:

FAILED

Instead show:

WHAT HAPPENED?

Quick options:

Too tired

Distracted

No time

Started gaming

Didn't feel like it

Too difficult

Too boring

Unclear

Unexpected event

Other

Allow free-text explanation.

Store the response.

Then prepare an analysis context.

The future AI layer will analyze:

quest

duration

difficulty

timing

energy

mood

recent activity

similar quests

completion history

Boosts

Drains

user's explanation

17. RECOVERY

After a missed Quest:

Create:

RECOVERY MODE

Options:

5-minute Starter

10-minute Starter

15-minute Normal

Wildcard

Recovery should:

restore Momentum

create a positive continuation

avoid shame

avoid permanent punishment

teach the system what works

A comeback can generate a Trophy.

18. RUNS / STREAKS

Use Runs instead of Streaks.

Show:

current Run

best Run

Run milestones

recovery after missed days

One missed day should not destroy the user's entire identity.

19. BATTLES

Create a Daily Battle.

A Battle contains a small number of meaningful core Missions.

Example:

Battle:

Movement

Study

Personal responsibility

Completing the Battle:

BATTLE CLEARED

Then offer an optional:

BONUS ROUND

20. BOSS SYSTEM

Large Destinations can become Bosses.

Example:

BOSS:
Finish a personal project

Progress can be visualized as Boss HP.

Actions reduce Boss HP.

All Boss calculations must be deterministic.

21. DESTINATIONS

A Destination is a major life goal.

It contains:

title

description

priority

duration

milestones

quests

Boss

trophies

rewards

progress

status

schedule

related Attributes

Status values:

Proposed

Active

Paused

Revised

Completed

Abandoned

22. PERSONAL BLUEPRINT

Create an onboarding system where the user can describe their desired life naturally.

Example input:

"I want to become more active, productive and energetic, reduce passive gaming and scrolling, study consistently, work on projects, have interesting things to do, and still keep entertainment."

The AI integration later should convert this into:

direction

goals

priorities

motivators

preferred difficulty

preferred quest style

constraints

anti-goals

reward preferences

behavior strategy

Show:

THIS IS WHAT I UNDERSTOOD

Buttons:

✅ APPROVE

✏️ EDIT

🔄 REGENERATE

Nothing major should activate without approval.

For the initial UI, create the complete approval workflow even if AI is not yet connected.

23. ADAPTIVE GOALS

The user can add a new rough goal at any time.

Example:

"I want to get better at coding."

The AI layer later turns this into:

plan

milestones

schedule

missions

quests

timing

difficulty

rewards

Boss

Trophies

After approval, the Game Engine updates the active system.

24. PLAN ADAPTATION

The system should compare:

PLAN
vs
REAL BEHAVIOR

Example:

Planned:
45 minutes every evening

Actual:
30% completion

Observed:
15–20 minute sessions work better

AI proposes:

20 minutes × 4 weekdays
+
one longer weekend session

The user sees:

PLAN CHANGE PROPOSED

Buttons:

✅ APPLY

✏️ MODIFY

❌ REJECT

Never silently alter important long-term plans.

25. CHAT MODE

Create a complete ChatGPT-style conversation interface.

The user can ask:

questions

doubts

behavior questions

goal questions

plan questions

"what should I do?"

"why did I fail?"

"give me something interesting"

"create a challenge"

"change my goal"

"explain my progress"

The underlying LLM implementation will be connected later.

Build the UI and service boundary now.

26. CHAT CONTEXT

Prepare a Personal Context Engine.

It should eventually combine:

Personal Blueprint

active Destinations

Boosts

Drains

current state

recent activity

recent quests

missed quests

progress

learned behavior patterns

relevant long-term memory

relevant conversation memory

Do not dump the entire database into every request.

Create an abstraction:

PersonalContextService

It should return relevant structured context.

27. AI PROVIDER ARCHITECTURE

Create a model-agnostic architecture.

Conceptually:

AIProvider

PhoneLocalProvider

OllamaProvider

OnlineAPIProvider

Supported operations:

chat

analyzeBehavior

analyzeMissedQuest

generateNextMove

generateQuest

generateEvent

generateGoalPlan

generateRecovery

analyzeHistory

The rest of the application must not directly depend on a specific LLM.

28. AI CONTROL CENTER

Create a polished settings section:

🧠 AI CONTROL CENTER

Active Brain

Provider:
[ Auto ]

Model:
[ Selected model ]

Status:
[ Connected / Disconnected ]

Phone Local

Status:
Connected / Not connected

Model:
[ Select ]

Ollama

Endpoint:
[ Local endpoint ]

Model:
[ Select ]

[ Test Connection ]

Online API

Provider:
[ Select ]

API Key:
[ Secure input ]

Model:
[ Select ]

[ Test Connection ]

AI Modes

Auto

Phone Local

Ollama

Cloud

AI Off

29. ONE-CLICK MODEL SWITCHING

The user must be able to change the model from the app.

Do not require source-code edits.

Examples:

Phone:
Local Model A

Laptop:
Ollama Model B

Cloud:
OpenRouter Model C

One click should switch the active brain.

The UI should show:

Current Brain: Qwen Local

The underlying implementation will be connected later.

30. MODEL-SPECIFIC JOBS

Optionally allow separate model selection:

Chat Brain

Analysis Brain

Quest Brain

Event Brain

Planning Brain

This must remain configurable.

31. FALLBACK

The application must continue working if AI is unavailable.

Fallback:

Selected local model
→ alternative local model
→ optional online model
→ deterministic recommendation system

Never make the entire game dependent on a live LLM.

32. DETERMINISTIC ENGINE

Create clear services for:

Sparks

Rank

Momentum

Runs

Combos

Quest state

Rewards

Trophies

Boss progress

Destination progress

validation

scheduling

data integrity

state transitions

The LLM should never directly mutate important state.

Rule:

AI PROPOSES → ENGINE VALIDATES → SYSTEM APPLIES

Major long-term changes:

AI PROPOSES → USER APPROVES → ENGINE APPLIES

33. SQLITE / DATA LAYER

Prepare a clean repository/service abstraction for SQLite.

Entities:

profile

personal_blueprint

goals

milestones

boosts

drains

quests

quest_runs

daily_states

activity_events

attributes

rewards

trophies

chapters

bosses

experiments

behavior_patterns

conversation_memory

ai_analyses

settings

Do not hard-code database operations directly into UI components.

34. DEVICE STORAGE

The final application will use local storage:

Phone:
Local SQLite

Laptop:
Local SQLite

Do not treat Google Drive as a live SQLite database.

35. GOOGLE DRIVE VAULT

Prepare the application for a dedicated Google Drive folder:

PERSONAL-LIFE-GAME

Structure:

01_IDENTITY
02_GOALS
03_GAME
04_HABITS
05_ACTIVITY
06_PROGRESS
07_AI_MEMORY
08_EXPERIMENTS
09_SYNC
10_BACKUPS
11_EXPORTS
12_ATTACHMENTS

The final app will use this Drive for:

sync

backup

archive

exported data

AI memory

attachments

36. GOOGLE DRIVE CONNECTION UI

Create:

☁️ GOOGLE DRIVE

Status:
Not connected

Button:

[ CONNECT GOOGLE DRIVE ]

After connection:

Status:
Connected

Show:

Drive folder

storage estimate if available

last sync

sync status

last backup

Buttons:

[ SYNC NOW ]

[ BACKUP NOW ]

[ RESTORE ]

Do NOT ask the user to manually edit MCP source code.

The final application should expose connection/configuration through its settings UI.

37. GOOGLE DRIVE MCP ADAPTER

Create an abstraction:

DriveMcpProvider

Configuration should be external and replaceable.

Current official Google Drive MCP endpoint:

https://drivemcp.googleapis.com/mcp/v1

The current Google Drive MCP service is in Developer Preview and uses OAuth 2.0. Do not hard-code API-key authentication. The final connection flow should be designed so OAuth credentials/configuration can be supplied securely.

The MCP adapter should conceptually support:

search files

read file content

metadata

create file

copy file

download file

Do not give the LLM unrestricted Drive authority.

38. DRIVE SYNC

Create:

SyncProvider

DriveSyncProvider

Use event-based synchronization.

Every event should have:

event_id

device_id

timestamp

event_type

payload

schema_version

Make processing idempotent.

Prevent duplicate Sparks.

Prevent duplicate Quest completion.

Support conflict detection.

Keep per-device event streams separate.

39. LOCAL-FIRST REQUIREMENT

The core application must function without:

internet

Google Drive

cloud LLM

MCP

The local game engine must still work.

40. PERSONAL DATA SECURITY

Treat all personal behavior data as sensitive personal information.

Use:

protected local storage where possible

secure credentials

no hard-coded API secrets

explicit connection status

clear data export

clear data deletion

no unnecessary analytics

no third-party tracking by default

Never expose API keys in frontend source code.

41. ACTIVITY VERIFICATION

Create a verification architecture:

Verified
Self-reported
Evidence-based
Unverified

The UI must clearly show the status.

Never claim automatic verification without an actual data source.

42. LIFE INTEL

Create analytics pages showing:

activity trends

completion trends

missed quests

common reasons

strongest Boosts

strongest Drains

best quest durations

successful times

goal progress

Attribute progress

Run history

Momentum history

Prepare the UI for AI-generated insights.

43. EXPERIMENTS

Create:

🧪 EXPERIMENTS

The user can create:

7-day

14-day

custom experiments

Example:

"Does morning movement improve energy?"

Track variables and outcomes.

AI interpretation can be added later.

44. REWARD / LOOT SYSTEM

Create Vault.

The user can define rewards.

Examples:

gaming session

movie

hobby time

personal reward

theme unlock

title

cosmetic unlock

Do not hard-code rewards.

Make the entire economy configurable.

45. UNLOCK SYSTEM

Unlock:

themes

titles

trophies

chapters

visual elements

challenge types

world areas

Do not make unlocks dependent on spending money.

46. WORLD / JOURNEY

Create a visual Journey / World screen.

Possible areas:

Vitality

Knowledge

Focus

Craft

Exploration

Connection

Creativity

Order

Areas improve as the user progresses.

Allow the Attributes to be customized later.

47. IDENTITY

Create Identity screen.

Show:

Avatar

Rank

Sparks

Momentum

Run

Attributes

Trophies

Titles

Chapters

Destinations

The character represents the user's real-life progress.

48. DEBRIEF

Create a lightweight end-of-day Debrief.

Questions:

What went well?

What didn't?

What blocked me?

What should tomorrow change?

Keep it quick.

49. DYNAMIC EVENTS

Prepare the architecture for AI-generated events:

Examples:

Double Spark Window

Weekend Surge

Exploration Event

Knowledge Raid

Comeback Event

Personal Boss Event

Wildcard Event

Events must go through the deterministic engine for validity.

50. NOTIFICATION PHILOSOPHY

Notifications should be useful, not spammy.

Avoid:

constant notifications

manipulative notifications

pressure loops

Prefer:

important quest reminder

recovery suggestion

scheduled mission

goal milestone

meaningful event

Allow full customization.

51. ACCESSIBILITY / USABILITY

Support:

readable text

clear buttons

touch-friendly controls

dark/light theme

reduced-motion preference

keyboard navigation where relevant

responsive layouts

52. ERROR HANDLING

Every external system must have:

connection state

loading state

success state

error state

retry option

fallback behavior

Especially:

Ollama

phone-local model

online AI

Google Drive

MCP

53. TESTABLE ARCHITECTURE

Build clear boundaries so these can be tested independently:

GameEngine

BehaviorEngine

QuestEngine

RewardEngine

MemoryEngine

ContextEngine

AIProvider

SyncProvider

DriveMcpProvider

LocalRepository

Do not create a giant monolithic component.

54. EXPORT / RUNTIME INDEPENDENCE

The application must be designed so that after the Lovable project is exported or synchronized to GitHub:

the source code can be run locally

dependencies can be replaced

environment variables can be added

the application does not require Lovable to remain online

AI providers can be configured from the app

Google Drive can be configured from the app

Do not make the final experience depend on manual source editing for normal configuration.

55. FINAL SETTINGS EXPERIENCE

Create a complete:

⚙️ SYSTEM SETTINGS

Sections:

AI

Provider
Model
API keys
Ollama
Phone Local
Cloud fallback

Google Drive

Connect
Sync
Backup
Restore
Folder

Game

Sparks
Rank
Run
Combo
Momentum
Rewards
Difficulty

Personal

Blueprint
Goals
Preferences
Motivation
Notifications

Data

Export
Backup
Restore
Delete

Appearance

Theme
Sound
Animation
Reduced motion

56. IMPORTANT: DO NOT BUILD PLACEHOLDER BUTTONS WITHOUT ARCHITECTURE

Where real external integration cannot yet be completed inside Lovable, create:

typed interface

service abstraction

configuration UI

clear status state

clear TODO/integration boundary

Do not fake "connected" status.

Do not pretend an LLM or Drive connection exists before it is actually configured.

57. BUILD QUALITY

Use:

clean component architecture

reusable components

typed models

validation

error handling

responsive design

maintainable code

separation of concerns

service/repository patterns

clear naming

comments only where useful

Avoid unnecessary dependencies.

Do not add a cloud database merely because it is convenient.

58. FINAL DELIVERY FROM THIS LOVABLE BUILD

The Lovable project should contain the complete:

UI

navigation

game screens

behavior screens

Personal Blueprint

adaptive Goals UX

Chat UI

AI Control Center

model switcher UI

Drive settings

sync settings

backup settings

deterministic service boundaries

repository boundaries

AI provider interfaces

Drive MCP abstraction

responsive mobile design

polished visual system

The actual provider connections can be finalized after exporting the project and installing the required dependencies/runtime.

59. FINAL EXPERIENCE

The user should be able to install the final application and see:

WELCOME

"Build your Life Game."

Then:

Describe yourself

Approve Personal Blueprint

Configure AI Brain

Connect Google Drive

Configure optional cloud model

Start first Quest

Then:

RANK 1

⚡ 0 SPARKS

🌊 MOMENTUM 0

⚡ NEXT MOVE

The application becomes the user's personal Life Game.

60. FINAL ARCHITECTURE

                         🎮 PERSONAL LIFE RPG
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
       PRESENTATION          GAME ENGINE             CHAT
          │                       │                       │
       Mobile UI           Deterministic Core      Context Engine
       Desktop UI          Behavior Engine         Memory Engine
          │                       │                       │
          └───────────────────────┼───────────────────────┘
                                  │
                           🧠 AI ROUTER
                                  │
                    ┌─────────────┼─────────────┐
                    │             │             │
                📱 Phone       💻 Ollama      ☁️ Cloud
                Local LLM      Local LLM      API Model
                    │             │             │
                    └─────────────┼─────────────┘
                                  │
                          Selected AI Brain
                                  │
                 ┌────────────────┴────────────────┐
                 │                                 │
            🗄️ Local SQLite                   ☁️ Google Drive
                 │                                 │
          Live device state                 Sync / Backup / Memory
                                                   │
                                             Google Drive MCP
                                                   │
                                            Controlled AI access


61. NON-NEGOTIABLE RULES

Personal-only application.

No unnecessary SaaS architecture.

No mandatory cloud database.

Local-first.

SQLite for local live state.

Google Drive for backup/sync/cloud vault.

Do not share a live SQLite file through Drive.

AI is replaceable.

Model switching happens through UI.

API keys are configurable securely.

Drive connection happens through a proper Google authentication flow.

LLM does not directly control deterministic state.

Important plan changes require user approval.

The application continues without AI.

The application continues without internet.

The app rewards real-world actions.

Do not optimize for screen time.

Missed quests become learning data.

Never shame the user.

Keep architecture modular and exportable.

Do not fake external connections.

Do not require source-code editing for ordinary configuration.

Build mobile-first.

Make the final project capable of becoming an Android APK.

The real user is the player; the digital avatar represents real-world progress.


PROMPT END

## Development


Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
