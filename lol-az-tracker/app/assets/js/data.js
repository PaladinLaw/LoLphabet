// ---- Champion data: add more lanes later by adding entries with a different role ----
let LISTS = {};
LISTS.Jungle = `Aatrox
Amumu
Bel'Veth
Briar
Cho'Gath
Darius
Diana
Dr. Mundo
Ekko
Elise
Evelynn
Fiddlesticks
Fizz
Gragas
Graves
Gwen
Hecarim
Ivern
Jarvan IV
Jax
Jayce
Karthus
Kayn
Kha'Zix
Kindred
Lee Sin
Lillia
Locke
Malphite
Master Yi
Mordekaiser
Naafiri
Nidalee
Nocturne
Nunu & Willump
Pantheon
Qiyana
Quinn
Rammus
Rek'Sai
Rengar
Sejuani
Shaco
Shyvana
Sion
Skarner
Sylas
Taliyah
Talon
Teemo
Trundle
Tryndamere
Udyr
Vi
Viego
Volibear
Warwick
Wukong
Xin Zhao
Zac
Zed
Zyra`;
LISTS.Top = `Aatrox
Akali
Ambessa
Camille
Cho'Gath
Darius
Dr. Mundo
Fiora
Gangplank
Garen
Gnar
Gragas
Gwen
Heimerdinger
Illaoi
Irelia
Jax
Jayce
K'Sante
Kayle
Kennen
Kled
Malphite
Malzahar
Master Yi
Mordekaiser
Nasus
Olaf
Ornn
Pantheon
Poppy
Quinn
Renekton
Riven
Rumble
Sett
Shen
Singed
Sion
Swain
Sylas
Tahm Kench
Teemo
Trundle
Tryndamere
Urgot
Varus
Vayne
Vladimir
Volibear
Warwick
Wukong
Yasuo
Yone
Yorick
Zaahen`;
LISTS.Mid = `Ahri
Akali
Akshan
Anivia
Annie
Aurelion Sol
Aurora
Azir
Brand
Cassiopeia
Cho'Gath
Diana
Ekko
Ezreal
Fizz
Galio
Garen
Heimerdinger
Hwei
Irelia
Jayce
Kassadin
Katarina
LeBlanc
Lissandra
Locke
Lux
Malphite
Malzahar
Mel
Morgana
Naafiri
Nasus
Orianna
Pantheon
Qiyana
Ryze
Sion
Smolder
Swain
Sylas
Syndra
Taliyah
Talon
Tristana
Twisted Fate
Veigar
Vel'Koz
Vex
Viktor
Vladimir
Xerath
Yasuo
Yone
Zed
Ziggs
Zoe`;
LISTS["Bot / ADC"] = `Aphelios
Ashe
Caitlyn
Corki
Draven
Ezreal
Hwei
Jhin
Jinx
Kai'Sa
Kalista
Katarina
Kog'Maw
Lucian
Lux
Mel
Miss Fortune
Nilah
Samira
Senna
Sivir
Smolder
Swain
Syndra
Tristana
Twitch
Varus
Vayne
Veigar
Viktor
Xayah
Xerath
Yasuo
Yunara
Zeri
Ziggs`;
LISTS.Support = `Alistar
Amumu
Ashe
Bard
Blitzcrank
Brand
Braum
Camille
Galio
Hwei
Janna
Karma
LeBlanc
Leona
Lulu
Lux
Malphite
Maokai
Mel
Milio
Miss Fortune
Morgana
Nami
Nautilus
Neeko
Pantheon
Poppy
Pyke
Rakan
Rell
Renata Glasc
Senna
Seraphine
Shaco
Shen
Sona
Soraka
Swain
Sylas
Tahm Kench
Taric
Teemo
Thresh
Veigar
Vel'Koz
Xerath
Yuumi
Zilean
Zoe
Zyra`;
for(const r in LISTS) LISTS[r]=LISTS[r].split("\n").map(s=>s.trim()).filter(Boolean).map(name=>({name,role:r}));
const ROLE_KEYS=["Top","Jungle","Mid","Bot / ADC","Support"];
const SETS={
"race:Yordles":"Amumu,Corki,Fizz,Gnar,Heimerdinger,Kennen,Kled,Lulu,Poppy,Rumble,Teemo,Tristana,Veigar,Vex,Ziggs",
"race:Vastayan":"Ahri,Aurora,Nami,Neeko,Nidalee,Rakan,Rengar,Sett,Wukong,Xayah",
"race:Darkin":"Aatrox,Kayn,Naafiri,Varus,Zaahen",
"race:Void creatures":"Bel'Veth,Cho'Gath,Kai'Sa,Kassadin,Kha'Zix,Kog'Maw,Malzahar,Rek'Sai,Vel'Koz",
"race:Celestials":"Aurelion Sol,Kayle,Leona,Morgana,Pantheon,Soraka,Taric,Zoe",
"race:Undead":"Amumu,Briar,Hecarim,Kalista,Karthus,Mordekaiser,Nautilus,Pyke,Sion,Thresh,Viego,Yone",
"region:Demacia":"Fiora,Galio,Garen,Jarvan IV,Kayle,Locke,Lucian,Lux,Morgana,Poppy,Quinn,Shyvana,Sona,Sylas,Vayne,Xin Zhao",
"region:Noxus":"Ambessa,Briar,Cassiopeia,Darius,Draven,Katarina,Kled,LeBlanc,Mel,Mordekaiser,Rell,Riven,Samira,Sion,Swain,Talon,Vladimir",
"region:Ionia":"Ahri,Akali,Hwei,Irelia,Ivern,Jhin,Karma,Kayn,Kennen,Lee Sin,Lillia,Master Yi,Rakan,Sett,Shen,Syndra,Varus,Wukong,Xayah,Yasuo,Yone,Yunara,Zed",
"region:Piltover & Zaun":"Blitzcrank,Caitlyn,Camille,Corki,Dr. Mundo,Ekko,Ezreal,Heimerdinger,Janna,Jayce,Jinx,Orianna,Renata Glasc,Seraphine,Singed,Twitch,Urgot,Vi,Viktor,Warwick,Zac,Zeri,Ziggs",
"region:Freljord":"Anivia,Ashe,Aurora,Braum,Gnar,Gragas,Lissandra,Nunu & Willump,Olaf,Ornn,Sejuani,Trundle,Tryndamere,Udyr,Volibear",
"region:Shadow Isles":"Elise,Gwen,Hecarim,Kalista,Karthus,Maokai,Thresh,Vex,Viego,Yorick",
"region:Bilgewater":"Fizz,Gangplank,Graves,Illaoi,Miss Fortune,Nautilus,Nilah,Pyke,Tahm Kench,Twisted Fate",
"region:Shurima":"Akshan,Amumu,Azir,K'Sante,Naafiri,Nasus,Rammus,Renekton,Sivir,Taliyah,Xerath",
"region:Targon":"Aphelios,Aurelion Sol,Diana,Leona,Pantheon,Soraka,Taric,Zoe",
"region:Bandle City":"Corki,Lulu,Rumble,Teemo,Tristana,Veigar,Yuumi",
"region:Ixtal":"Malphite,Milio,Neeko,Nidalee,Qiyana,Rengar,Skarner,Zyra",
"region:Void":"Bel'Veth,Cho'Gath,Kai'Sa,Kassadin,Kha'Zix,Kog'Maw,Malzahar,Rek'Sai,Vel'Koz"};
for(const k in SETS) LISTS[k]=SETS[k].split(",").sort((a,b)=>a.localeCompare(b,"en",{sensitivity:"base"})).map(name=>({name,role:k}));
{const o={};for(const r of [...ROLE_KEYS,...Object.keys(SETS)])o[r]=LISTS[r];LISTS=o;}
const BUILTIN={...LISTS};
// Every champion, alphabetically ("All champs" tab) is built from this plus the lists and Data Dragon (see rebuildLists)
const ROSTER="Aatrox,Ahri,Akali,Akshan,Alistar,Ambessa,Amumu,Anivia,Annie,Aphelios,Ashe,Aurelion Sol,Aurora,Azir,Bard,Bel'Veth,Blitzcrank,Brand,Braum,Briar,Caitlyn,Camille,Cassiopeia,Cho'Gath,Corki,Darius,Diana,Dr. Mundo,Draven,Ekko,Elise,Evelynn,Ezreal,Fiddlesticks,Fiora,Fizz,Galio,Gangplank,Garen,Gnar,Gragas,Graves,Gwen,Hecarim,Heimerdinger,Hwei,Illaoi,Irelia,Ivern,Janna,Jarvan IV,Jax,Jayce,Jhin,Jinx,K'Sante,Kai'Sa,Kalista,Karma,Karthus,Kassadin,Katarina,Kayle,Kayn,Kennen,Kha'Zix,Kindred,Kled,Kog'Maw,LeBlanc,Lee Sin,Leona,Lillia,Lissandra,Lucian,Lulu,Lux,Malphite,Malzahar,Maokai,Master Yi,Mel,Milio,Miss Fortune,Mordekaiser,Morgana,Naafiri,Nami,Nasus,Nautilus,Neeko,Nidalee,Nilah,Nocturne,Nunu & Willump,Olaf,Orianna,Ornn,Pantheon,Poppy,Pyke,Qiyana,Quinn,Rakan,Rammus,Rek'Sai,Rell,Renata Glasc,Renekton,Rengar,Riven,Rumble,Ryze,Samira,Sejuani,Senna,Seraphine,Sett,Shaco,Shen,Shyvana,Singed,Sion,Sivir,Skarner,Smolder,Sona,Soraka,Swain,Sylas,Syndra,Tahm Kench,Taliyah,Talon,Taric,Teemo,Thresh,Tristana,Trundle,Tryndamere,Twisted Fate,Twitch,Udyr,Urgot,Varus,Vayne,Veigar,Vel'Koz,Vex,Vi,Viego,Viktor,Vladimir,Volibear,Warwick,Wukong,Xayah,Xerath,Xin Zhao,Yasuo,Yone,Yorick,Yunara,Yuumi,Zaahen,Zac,Zed,Zeri,Ziggs,Zilean,Zoe,Zyra";
const cmp=(a,b)=>a.localeCompare(b,"en",{sensitivity:"base"});
