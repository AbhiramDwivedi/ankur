// The words of an inbox confirmation code (three of them, drawn by crypto.randomInt in inbox.ts). Plain lowercase words of 3 to 7 letters that read
// aloud and type without doubt. None is a decision word of the inbox (approve, reject, answer, done, dismiss) or `raise` or `code`, so a code can
// never be read as part of a typed approval line. The list size sets the guess odds: N words give N^3 codes, and N is at least 1024.

const WORDS = `
acorn adder alder almond amber anchor angel ankle antler apple apron arrow aspen atlas attic aurora autumn badger bagel bakery balsa bamboo banjo
barley barn basil basin basket beach beacon beaver bell berry birch bison blanket blossom boat bobcat bonnet bottle bramble branch bread breeze
brick bridge bronze brook broom bucket buckle bugle butter button cabin cable cactus camel candle canoe canyon carpet carrot castle cattle cedar
cellar cherry chess chime cider cinder circus citrus clay clover cobalt cobweb cocoa coconut comet compass copper coral cotton cougar cove
cowboy crane crayon creek cricket crown crystal cuckoo cypress daisy dancer dapple delta desert dingo dolphin donkey dragon drift drum eagle
ember emerald engine falcon fable feather fennel ferret fern ferry fiddle finch fjord flame flint flute forest fossil fox frost garden garlic
gazelle gecko geyser ginger glacier glove goat goblet gopher granite grape gravel grove guitar gull hammer harbor harp hawk hazel heron hickory
hill hollow honey horizon hornet iceberg igloo island ivory ivy jacket jaguar jasmine jelly jester jigsaw juniper kayak kettle kitten koala
lagoon lamp lantern lark laurel lava lemon lentil leopard lilac lily linen lizard lobster locust lotus lumber lynx magnet mango maple marble
marsh meadow melon mint mirror mitten mole monkey moose moss motor mulberry mussel nectar needle nettle nickel noodle nutmeg oasis oak ocean
olive onion opal orange orchid osprey otter oven owl oyster paddle palm panda panther papaya parrot pasture peach peacock pear pearl pebble
pelican pepper petal pigeon pillow pine pistol planet plum pocket pond poplar poppy prairie pretzel pumpkin puzzle quail quartz quill rabbit
raccoon radish rafter raven reed ribbon river robin rocket rose saddle saffron sage salmon sand sapphire satin scarf shell shore silver skiff
sleet spark sparrow spice spider spruce squirrel stable starling stone stork stream sunset swan swift tablet tallow tango teapot thistle thorn
thunder tiger timber toast tomato topaz tortoise tulip tunnel turtle valley velvet violet walnut walrus weasel willow window wolf wombat yarrow
zebra zinnia
about above across adapt admire advice affair afford agile agree ahead alarm alert alive alley allow alone amaze ample angle annual anthem
arch arena arise array aside atom awake award aware bacon badge baker balance ballad bandit banner barrel basic batch beam beard bench berth
bike bingo bishop blade blaze blend bliss block bloom blue board bonus boost border bounce bowl brave brief bright brisk brush buddy buffet
bundle burst cabbage cadet calm camp candy canvas cape cargo carve cash catch cause cavern chair chalk charm chart cheer chest chief chip
choir chord churn cider civic claim clap class clean clear clerk cliff climb clock cloud clown club coach coast coin color cook cool coral
corner couch count court cover craft crash cream crest crisp crowd cube curve cycle dagger dance dart dawn deal debut decay deck deer depth
desk detail diary diner disco ditch diver dock dome donut doorway dough dozen draft dream dress drill drive dune dusk dwell earth easel echo
edge elbow elder elite elm empty enjoy enter entry equal error essay event exact exit extra fabric face fair faith fancy farm fast feast
fence field fifth fig film final first fish flag flame flash fleet flock floor flour flow flower focus foggy folk food forge fork fort forum
frame fresh friend frog fruit fudge funny galaxy game gate gear giant gift glad glass globe glow gold grace grain grand grass great green
greet grid group guard guest guide habit hair half hall halo hand happy hard harvest haste hatch haven heart heat heavy hedge hello help hero
hobby holiday home hope horse hotel house hover human humor hurry hush idea image inbox index inner input iris iron issue item jazz jeans
jewel join joke jolly journey joy judge juice jumbo jump jungle junior just keen keep kind king kiosk kite kitchen knack knee knife knit knob
knot label lace ladder lake land lane large laser latch laugh lawn layer leaf learn ledge legend lemon lever level light limit line link lion
list live llama loaf lobby local lodge logic long loop loose lucky lunar lunch lyric magic major maker march mark market mason match maybe
meal medal media melody member memo mentor merry metal meter middle might mild mile mill mind miner minor minute misty mixer model moment
money month moon moral motto mount mouse mouth movie much music myth naive name navy neat nest never newly next nice night noble noise north
note novel nurse nylon oasis offer often olden omega onset opera orbit order organ other otter outer oval owner pace pack paint pair panel
paper parade park party pasta patch path pause peace pedal penny perch phase phone photo piano pick piece pilot pinch pitch pixel pizza place
plain plan plank plant plaza pledge plot plume point polar polish pony pool porch port pose pouch pound power press price pride prime print
prize proof proud pulse punch pupil purple purse quest quick quiet quilt quote race radar radio rain rally ranch range rapid rare raven reach
ready realm rebel record reef relax relay remedy rest reward rhythm rice rich ride ridge right ring ripe rise risk ritual road roam roast
robe robot rock roll roof room root rope round route royal ruby rule rural sail salad salt sample sauce scale scene scout screen scroll seal
season seat second seed sense serve seven shade shadow shape share sharp sheep shelf shine ship shirt shoe shop short shout show shrimp side
sight sign silk simple sing sister size sketch skill skirt sky slate sleep slice slide slope small smart smile smoke smooth snack snail snake
snow soap social soft solar solid song sound south space spare speak speed spell spend spin spirit split spoon sport spot spring square stage
stair stamp stand star start state steam steel steep step stick still stock storm story stove strap straw strike string strong studio study
style sugar suit summer sun super supper surf sweet swim swing table tackle tail talent talk tall tank tape task taste teach team tent tenth
terrace theory thick thing think third three throne thumb ticket tide tidy tile time tiny title today token tool tooth topic torch total touch
tough tower town toy trace track trade trail train travel tray treat tree trend trial tribe trick trio trophy truck trust truth tube tune
twice twin uncle under union unit upper urban usual valid value van vapor vase vault vegan verse vest video view village vine vision visit
vital vivid vocal voice voyage wagon waist walk wall waltz wand warm wash watch water wave wax way wealth weave wedge week weight whale wheat
wheel whisk whole wide width wild win wind wine wing winter wire wise wish wit wizard wolf wonder wood wool word work world worth wrap wren
yard year yellow yield young youth zest zone
anvil argon aroma bagpipe baton bayou beech bellow bluff bolt bough bowline brine brook buoy burrow cairn cameo canal canopy caper caravan
carbon cashew cellar chalet channel chapel cheddar chestnut chisel chorus cinema clarity clay cloak clover cobbler compost condor copse
corridor cottage courier cradle crater crimson crumb cumin curlew dahlia dapple dawdle dawn decoy dewdrop dinghy dory drizzle dune durable
eddy elk epoch ermine estuary fable falcon fathom ferret fiesta fig filbert flannel fleece flora flume foal foothill fortune fountain
foxglove fresco furrow gadget galley gamut garnet gaucho gavel gentle gizmo glade gleam glider glimmer gorge granary gravy greenery grotto
gryphon gust gypsum hamlet hammock harbor harvest hatchet haze heather helm hemlock hermit hinge hoist hollyhock homestead hoof hostel hound
hutch icicle inlet inkwell jackal jade jamboree jerky jetty jonquil kelp kernel kestrel kiln kindle kingfisher knoll lacquer lariat lattice
lavender ledger lichen lilt limpet linnet lodestar loom lullaby lumen lupine macaw mallard mantle marten mason meander mellow merlin mesa
midge millet minnow mistral mizzen mortar mosaic mulch muskrat narwhal nimbus nomad oatmeal obelisk ochre olivine orchard oriole outpost
paddock pagoda palette pampas parsley parchment pasture pavilion peat pennant pewter pinecone piper plover plateau plinth pollen pommel
porcelain portal prism puffin pulley quarry quince quiver raft rampart rapids rattan reservoir rhubarb ridgeline rivet rookery rowboat rudder
rushes rye sable sailor salvia sampler sandal sargent sassafras saucer sawmill scarlet sedge seesaw serene settle shale shanty sheaf shingle
shoal shrub sienna sierra signal silo skylark sloop snowfall solstice sorrel sparkle spindle spinney sprig spur steeple sterling stirrup
stoat stoop strait strand sundial sunbeam surge swallow swamp sycamore tamarind tangle tapestry tarn tassel teal tern thicket thimble
thrush tidal tinder toadstool tonic torrent trellis trestle trinket trowel trumpet tundra turret twilight umber upland vale vanilla vessel
vestry vineyard violin vista wagtail wallet wander warbler wharf whimsy whirl whistle wicker wigeon wildcat windmill wintry wisp wistful
woodland wrangler yeoman yonder zephyr zenith
`

export const CODE_WORDS: readonly string[] = Object.freeze([...new Set(WORDS.split(/\s+/).filter((w) => /^[a-z]{3,7}$/.test(w) && !['approve', 'reject', 'answer', 'done', 'dismiss', 'raise', 'code'].includes(w)))])
