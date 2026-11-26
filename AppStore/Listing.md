# GlassHouse: App Store listing (1.0)

Everything that goes into App Store Connect for version 1.0, in one place.

## Identity

| | |
|---|---|
| **Name** (30) | GlassHouse: Singing Glass |
| **Subtitle** (30) | Glass, bowl and harp that sing |
| **Bundle ID** | com.samuelling.glasshouse |
| **SKU** | glasshouse |
| **Primary category** | Music |
| **Secondary category** | Education |
| **Price** | Free |
| **Copyright** | 2026 Sam Ling |
| **Privacy policy** | https://linglab.org/glasshouse/privacy.html |
| **Support URL** | https://linglab.org/glasshouse/support.html |
| **Marketing URL** | https://linglab.org/glasshouse/ |
| **Devices** | iPhone and iPad, iOS/iPadOS 17 or later |

## Promotional text (170)

Run your finger around the rim and the glass begins to sing. No recordings: the glass, the water and your fingertip are simulated live, from the physics up.

## Description

Run a wet finger around the rim of a wine glass and it sings. GlassHouse lets you do that on your iPhone or iPad, and nothing you hear is a recording.

THE GLASS
Circle the rim, about a lap a second, and feel the tone catch and swell. Press harder and it squeaks; go too fast and it slips. Tap inside to flick it with a fingernail. Choose lead crystal or soda-lime, a Bordeaux bowl or a flute, a thin rim or a thick one.

POUR WATER TO PLAY
Slide your thumb along the strip at the bottom of the screen and water pours in or out. More water, lower note: the water loads the wall exactly as it does in a real glass. Hold the phone in one hand, bend the pitch with your thumb and circle the rim with the other, like a theremin made of glass. A side view shows the water level as you play.

THE SINGING BOWL
A hammered Tibetan singing bowl, circled with a puja. A leather-wrapped puja coaxes out a long, swelling song. Bare wood is stiff, so once the bowl gets loud it starts to bounce off the wall and rattle, just as a real one does.

THE GLASS HARP
Four to six glasses, each tuned by its water to the note you choose, or to a whole scale at once. Play several at once with several fingers, or play the keyboard beneath them. Switch on armonica mode and the keys rub the glasses for you.

BRING A KEYBOARD
Plug in a USB MIDI keyboard or connect a Bluetooth one, and GlassHouse finds it. On the glass, each key pours exactly enough water to sound its note. On the harp, each key pours water into a free glass until it reaches the note. The mod wheel sets how hard you press.

NOTHING IS SAMPLED
The glass is solved as an elastic shell with the finite element method, from its real shape and the stiffness and density of real crystal. The water is computed as fluid flowing inside that shape. Your fingertip grips and slips on the rim through a friction law for wet skin on glass, and the sound radiates into the room the way it does from a real glass. All of it runs live on your device. Open "physics, in detail" in the app for the whole story.

MADE FOR LISTENING
Plays through the silent switch, with a gentle tick under your thumb at each semitone. No account, no ads, no tracking. Works in airplane mode.

## Keywords (100)

glass harp,armonica,singing bowl,tibetan,wine glass,meditation,physics,synth,midi,crystal,ambient

## What's New

First release.

## Screenshots

Raw captures: `node tools/shots.js iphone|ipad AppStore/screenshots/raw/<device>` (the app's own pages at exact device size, played live). Captions: `python3 AppStore/frame.py`. Upload: Actions → Listing screenshots.

| # | iPhone 6.9" (1320×2868), iPad 13" (2064×2752) |
|---|---|
| 1 | Circle the rim. *It sings.* |
| 2 | Pour to *bend the pitch.* |
| 3 | A Tibetan *singing bowl.* |
| 4 | A glass harp, *tuned by water.* |
| 5 | Pure *physics.* |
| 6 | Bring a *keyboard.* |

## App privacy

**Data Not Collected.** The app makes no network connections; everything, including its typefaces, is in the bundle. It does not use the microphone. MIDI device names are shown on screen and go nowhere. (`ios/GlassHouse/PrivacyInfo.xcprivacy` declares the same.)

## Export compliance

`ITSAppUsesNonExemptEncryption = NO` in `ios/GlassHouse-Info.plist`. The app uses no encryption.

## Age rating

All "None". No web access, no user-generated content, no purchases, no advertising, no accounts. Rated 4+.

## Review notes

GlassHouse is a physically modelled musical instrument: a singing wine glass, a Tibetan singing bowl and a glass harp. No account or network is needed, and all content is in the app.

To try it:
1. Turn the volume up (the app plays even with the silent switch on).
2. GLASS: run a finger slowly around the bright rim, about one lap per second. The glass begins to sing after a moment. Slide along the strip at the bottom to pour water and change the pitch.
3. BOWL: circle just outside the rim slowly (about half a lap per second) and let it build.
4. HARP: touch and circle any of the glasses, or turn on "Keys rub too" and press the keyboard.

MIDI (optional): with a USB MIDI keyboard attached, notes set the glass's pitch, and on the harp they pour a free glass to the note. "Bluetooth MIDI…" in the menu opens Apple's standard Bluetooth MIDI panel; Bluetooth is used only there. No MIDI hardware is needed to review the app.

How it is built: the instrument's physics (a finite-element shell solver, fluid added mass and stick-slip friction), its sound engine and its visuals run locally inside the app. The native app adds Core MIDI input from USB, Bluetooth and network devices, Apple's Bluetooth MIDI pairing panel, a playback audio session, haptics, and keeping the screen awake while playing.
