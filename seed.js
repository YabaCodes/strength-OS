window.STRENGTH_OS_SEED = (() => {
  const muscles = [
    {id:"chest",name:"Chest",region:"front"},
    {id:"lats",name:"Lats",region:"back"},
    {id:"upper_back",name:"Upper Back",region:"back"},
    {id:"traps",name:"Traps",region:"back"},
    {id:"lower_back",name:"Lower Back",region:"back"},
    {id:"front_delts",name:"Front Delts",region:"front"},
    {id:"side_delts",name:"Side Delts",region:"both"},
    {id:"rear_delts",name:"Rear Delts",region:"back"},
    {id:"biceps",name:"Biceps",region:"front"},
    {id:"triceps",name:"Triceps",region:"back"},
    {id:"forearms",name:"Forearms",region:"both"},
    {id:"quads",name:"Quads",region:"front"},
    {id:"hamstrings",name:"Hamstrings",region:"back"},
    {id:"glutes",name:"Glutes",region:"back"},
    {id:"adductors",name:"Adductors",region:"front"},
    {id:"calves",name:"Calves",region:"both"},
    {id:"abs",name:"Abs",region:"front"},
    {id:"obliques",name:"Obliques",region:"front"}
  ];

  const targetRanges = {
    chest:[10,14],lats:[8,12],upper_back:[8,12],traps:[4,10],lower_back:[2,8],
    front_delts:[4,10],side_delts:[8,12],rear_delts:[6,12],biceps:[6,10],triceps:[6,10],
    forearms:[2,8],quads:[10,14],hamstrings:[8,12],glutes:[8,14],adductors:[4,8],calves:[6,10],abs:[4,8],obliques:[2,6]
  };

  const E = (id,name,primary,secondary=[],equipment="Other",tracking="weight_reps",min=8,max=12,rest=90,increment=2.5,notes="") => ({
    id,name,primaryMuscle:primary,secondaryMuscles:secondary,equipment,trackingType:tracking,
    defaultMin:min,defaultMax:max,defaultRest:rest,incrementKg:increment,notes,builtIn:true,archived:false,createdAt:Date.now()
  });

  const exercises = [
    E("bench","Barbell Bench Press","chest",["triceps","front_delts"],"Barbell","weight_reps",4,6,180,2.5),
    E("incline_press","Incline Machine / DB Press","chest",["front_delts","triceps"],"Machine / Dumbbell","weight_reps",8,12,120,2.5),
    E("cable_fly","Cable Fly","chest",[],"Cable","weight_reps",10,15,90,2.5),
    E("oh_tri","Overhead Cable Triceps Extension","triceps",[],"Cable","weight_reps",8,12,90,2.5),
    E("pressdown","Cable Pressdown","triceps",[],"Cable","weight_reps",10,15,75,2.5),
    E("lateral_raise","Lateral Raise","side_delts",[],"Dumbbell / Cable","weight_reps",12,20,75,1),
    E("pullup","Pull-Up","lats",["biceps","upper_back"],"Bodyweight","bodyweight_added",5,8,180,2.5),
    E("chest_row","Chest-Supported Row","upper_back",["lats","biceps","rear_delts"],"Machine / Dumbbell","weight_reps",6,10,120,2.5),
    E("lat_pulldown","Neutral / Single-Arm Lat Pulldown","lats",["biceps"],"Cable","weight_reps",8,12,105,2.5),
    E("rear_delt","Reverse Pec Deck / Rear-Delt Fly","rear_delts",["upper_back"],"Machine / Cable","weight_reps",12,20,75,2.5),
    E("incline_curl","Incline DB Curl","biceps",[],"Dumbbell","weight_reps",8,12,75,1),
    E("hammer_curl","Hammer Curl","biceps",["forearms"],"Dumbbell","weight_reps",10,15,75,1),
    E("squat","Back Squat","quads",["glutes"],"Barbell","weight_reps",4,6,210,5),
    E("hack_press","Hack Squat / Leg Press","quads",["glutes"],"Machine","weight_reps",8,12,150,5),
    E("leg_extension","Leg Extension","quads",[],"Machine","weight_reps",10,15,90,2.5),
    E("leg_curl","Seated Leg Curl","hamstrings",[],"Machine","weight_reps",8,12,105,2.5),
    E("standing_calf","Standing Calf Raise","calves",[],"Machine","weight_reps",8,15,75,2.5),
    E("knee_raise","Hanging Knee Raise","abs",["obliques"],"Bodyweight","reps_only",8,15,75,0),
    E("shoulder_press","Pain-Free Shoulder Press","front_delts",["side_delts","triceps"],"Machine / Dumbbell","weight_reps",6,10,150,2.5),
    E("preacher_curl","Preacher Curl","biceps",[],"Machine / EZ Bar","weight_reps",8,12,75,1),
    E("rdl","Romanian Deadlift","hamstrings",["glutes","lower_back"],"Barbell / Dumbbell","weight_reps",5,8,180,5),
    E("bss","Bulgarian Split Squat","quads",["glutes"],"Dumbbell","weight_reps",8,12,120,2.5),
    E("seated_row","Seated Cable / Machine Row","upper_back",["lats","biceps","rear_delts"],"Cable / Machine","weight_reps",8,12,105,2.5),
    E("weighted_plank","Weighted Plank","abs",["obliques"],"Plate","weight_duration",30,60,75,2.5),
    E("hip_thrust","Hip Thrust","glutes",["hamstrings"],"Barbell / Machine","weight_reps",8,12,120,5),
    E("dips","Dips","chest",["triceps","front_delts"],"Bodyweight","bodyweight_added",6,12,120,2.5),
    E("pushup","Push-Up","chest",["triceps","front_delts"],"Bodyweight","reps_only",8,30,75,0),
    E("leg_press","Leg Press","quads",["glutes"],"Machine","weight_reps",8,15,120,5),
    E("landmine_press","Landmine Press","front_delts",["triceps","chest"],"Barbell","weight_reps",8,12,120,2.5),
    // Added in v2.11 for muscles the original program under-trained or missed.
    E("seated_calf","Seated Calf Raise","calves",[],"Machine","weight_reps",10,20,60,2.5,"Knee bent, so the soleus does most of the work. Pause 1–2 s in the bottom stretch."),
    E("cable_crunch","Cable Crunch","abs",["obliques"],"Cable","weight_reps",10,15,75,2.5,"Curl the spine down toward the hips; don't just hinge at the hips."),
    E("hip_adduction","Hip Adduction","adductors",[],"Machine","weight_reps",10,15,75,2.5,"Start from a wide, controlled stretch."),
    E("face_pull","Face Pull","rear_delts",["upper_back","traps"],"Cable","weight_reps",12,20,75,2.5,"Pull toward the forehead and rotate the hands back at the end."),
    E("shrug","Shrug","traps",[],"Dumbbell / Machine","weight_reps",10,15,75,2.5,"Straight up and down; pause at the top."),
    // Added in v2.12 to complete forearms, the side of the hip and the obliques.
    E("wrist_curl","Wrist Curl","forearms",[],"Dumbbell / Barbell","weight_reps",12,20,60,1,"Forearms on a bench, palms up; let the wrist roll all the way down."),
    E("reverse_curl","Reverse Curl","forearms",["biceps"],"EZ Bar / Cable","weight_reps",10,15,60,1,"Palms down, elbows still at your sides."),
    E("hip_abduction","Hip Abduction","glutes",[],"Machine","weight_reps",12,20,60,2.5,"Lean slightly forward; control the way back in."),
    E("cable_woodchop","Cable Woodchop","obliques",["abs"],"Cable","weight_reps",10,15,60,2.5,"Reps are per side. Turn through the ribs, not the arms."),
    // Added in v2.13 so every muscle has at least three good options to choose from.
    E("cable_pullover","Straight-Arm Cable Pulldown","lats",[],"Cable","weight_reps",10,15,75,2.5,"Arms nearly straight; sweep the bar down to your thighs and feel the stretch at the top."),
    E("db_row","Single-Arm Dumbbell Row","lats",["upper_back","biceps","rear_delts"],"Dumbbell","weight_reps",8,12,105,2.5,"Reps are per side. Pull the elbow back toward the hip, not straight up."),
    E("barbell_row","Barbell Row","upper_back",["lats","biceps","rear_delts","lower_back"],"Barbell","weight_reps",6,10,150,2.5,"Torso about 45°, back flat; pull the bar to the lower ribs."),
    E("farmer_carry","Farmer's Carry","traps",["forearms","abs"],"Dumbbell","weight_duration",30,60,90,2.5,"Heaviest pair you can hold while standing tall. Log the weight per hand and the time."),
    E("y_raise","Incline Y-Raise","traps",["rear_delts","side_delts"],"Dumbbell","weight_reps",10,15,60,1,"Chest on a 30–45° bench; raise light dumbbells in a Y, thumbs up."),
    E("back_extension","45° Back Extension","lower_back",["glutes","hamstrings"],"Bodyweight","bodyweight_added",10,15,90,2.5,"Let the upper back round a little at the bottom for the lower back. Hold a plate when 15 is easy."),
    E("deadlift","Deadlift","lower_back",["glutes","hamstrings","traps","forearms","quads"],"Barbell","weight_reps",3,6,210,5,"Brace before each rep, then push the floor away; the bar stays against your legs."),
    E("good_morning","Good Morning","lower_back",["hamstrings","glutes"],"Barbell","weight_reps",8,12,120,2.5,"Start light. Soft knees, push the hips back until the hamstrings stretch; back stays flat."),
    E("ohp","Overhead Press","front_delts",["side_delts","triceps","traps"],"Barbell","weight_reps",4,8,180,2.5,"Standing, glutes tight; press up and slightly back, head through at the top."),
    E("machine_lateral","Machine Lateral Raise","side_delts",[],"Machine","weight_reps",12,20,75,2.5,"Lead with the elbows; pause briefly at the top."),
    E("upright_row","Wide-Grip Cable Upright Row","side_delts",["traps"],"Cable","weight_reps",10,15,75,2.5,"Hands wider than the shoulders; raise the elbows out and up to chest height, no higher."),
    E("rear_delt_row","Rear-Delt Row","rear_delts",["upper_back","traps"],"Cable","weight_reps",12,15,75,2.5,"Wide grip, elbows out at shoulder height; pull toward the upper chest."),
    E("bayesian_curl","Bayesian Cable Curl","biceps",[],"Cable","weight_reps",10,15,75,1,"Reps are per side. Face away from a low pulley with the arm behind you; keep the elbow back as you curl."),
    E("ez_curl","EZ-Bar Curl","biceps",["forearms"],"EZ Bar","weight_reps",6,10,90,2.5,"Elbows stay at your sides; no swinging from the hips."),
    E("skull_crusher","EZ-Bar Skull Crusher","triceps",[],"EZ Bar","weight_reps",8,12,90,2.5,"Lower the bar behind your head, not to the forehead, for a bigger stretch."),
    E("close_grip_bench","Close-Grip Bench Press","triceps",["chest","front_delts"],"Barbell","weight_reps",6,10,150,2.5,"Hands about shoulder-width, elbows tucked; touch the lower chest."),
    E("wrist_extension","Reverse Wrist Curl","forearms",[],"Dumbbell","weight_reps",15,20,60,1,"Forearms on a bench, palms down; lift the back of the hand. Light weight, slow reps."),
    E("dead_hang","Dead Hang","forearms",["lats"],"Bodyweight","duration",20,60,90,0,"Full grip on a pull-up bar. When 60 s is easy, hold a dumbbell between the feet or hang one-handed."),
    E("lying_leg_curl","Lying Leg Curl","hamstrings",[],"Machine","weight_reps",8,12,105,2.5,"Hips stay pressed into the pad. The seated curl grows the hamstrings a bit more; this is the next best."),
    E("nordic_curl","Nordic Curl","hamstrings",[],"Bodyweight","reps_only",3,8,120,0,"Heels anchored; lower yourself as slowly as you can, then push back up with your hands."),
    E("walking_lunge","Walking Lunge","glutes",["quads","adductors","hamstrings"],"Dumbbell","weight_reps",8,12,120,2.5,"Reps are per leg. A long stride and a slight forward lean put more work on the glutes."),
    E("cable_kickback","Cable Glute Kickback","glutes",["hamstrings"],"Cable","weight_reps",10,15,60,2.5,"Reps are per side. Kick back and slightly out without arching the lower back."),
    E("copenhagen","Copenhagen Plank","adductors",["obliques","abs"],"Bodyweight","duration",15,40,60,0,"Top leg on a bench, body in a straight line. Time is per side; bend the top knee to make it easier."),
    E("cable_adduction","Standing Cable Adduction","adductors",[],"Cable","weight_reps",12,15,60,2.5,"Reps are per side. Ankle strap on the near leg; sweep it across the body."),
    E("leg_press_calf","Leg Press Calf Raise","calves",[],"Machine","weight_reps",10,15,60,5,"Balls of the feet on the bottom edge, knees straight; full stretch at the bottom."),
    E("ab_wheel","Ab Wheel Rollout","abs",["obliques","lats"],"Other","reps_only",6,12,75,0,"From the knees; roll out only as far as you can keep the lower back from sagging."),
    E("pallof_press","Pallof Press","obliques",["abs"],"Cable","weight_reps",10,15,60,2.5,"Reps are per side. Side-on to the cable, press straight out and hold 2 s without twisting."),
    E("side_plank","Side Plank","obliques",["abs","glutes"],"Bodyweight","duration",20,60,60,0,"Straight line from head to feet. Time is per side."),
    E("side_bend","Dumbbell Side Bend","obliques",[],"Dumbbell","weight_reps",12,15,60,2.5,"Reps are per side. One dumbbell; bend only sideways, not forward.")
  ];

  // The part of the muscle each exercise is meant for, shown under the exercise name.
  const focus = {
    bench:"Mid & lower chest (sternal head)", incline_press:"Upper chest (clavicular head)", cable_fly:"Mid & lower chest",
    oh_tri:"Triceps long head", pressdown:"Triceps lateral & medial heads", lateral_raise:"Side delts",
    pullup:"Lats", chest_row:"Mid back (rhomboids, mid traps) & lats", lat_pulldown:"Lats",
    rear_delt:"Rear delts", incline_curl:"Biceps long head", hammer_curl:"Brachialis & brachioradialis",
    squat:"Quads, glutes & adductors", hack_press:"Quads (outer & inner)", leg_extension:"Quads incl. rectus femoris",
    leg_curl:"Hamstrings (all heads)", standing_calf:"Calves: gastrocnemius", knee_raise:"Lower abs & hip flexors",
    shoulder_press:"Front delts", preacher_curl:"Biceps short head", rdl:"Hamstrings & glutes (hip hinge)",
    bss:"Quads & glutes", seated_row:"Mid back & lats", weighted_plank:"Core bracing (abs & obliques)",
    hip_thrust:"Glutes (glute max)", dips:"Lower chest & triceps", pushup:"Chest & triceps",
    leg_press:"Quads & glutes", landmine_press:"Upper chest & front delts",
    seated_calf:"Calves: soleus", cable_crunch:"Abs (rectus abdominis)", hip_adduction:"Inner thigh (adductors)",
    face_pull:"Rear delts & rotator cuff", shrug:"Upper traps",
    wrist_curl:"Forearm flexors (underside)", reverse_curl:"Brachioradialis & wrist extensors (top of forearm)",
    hip_abduction:"Glute medius (side of the hip)", cable_woodchop:"Obliques",
    cable_pullover:"Lats (arms straight)", db_row:"Lats & mid back", barbell_row:"Mid back & lats",
    farmer_carry:"Upper traps & grip", y_raise:"Lower & mid traps", back_extension:"Lower back (spinal erectors)",
    deadlift:"Lower back, glutes & hamstrings", good_morning:"Lower back & hamstrings", ohp:"Front delts & triceps",
    machine_lateral:"Side delts", upright_row:"Side delts & upper traps", rear_delt_row:"Rear delts & upper back",
    bayesian_curl:"Biceps long head (stretched)", ez_curl:"Biceps (both heads)", skull_crusher:"Triceps long head",
    close_grip_bench:"Triceps (all heads)", wrist_extension:"Wrist extensors (top of forearm)", dead_hang:"Grip (forearm flexors)",
    lying_leg_curl:"Hamstrings (all heads)", nordic_curl:"Hamstrings (lowering strength)", walking_lunge:"Glutes & quads",
    cable_kickback:"Glutes (glute max)", copenhagen:"Adductors (groin strength)", cable_adduction:"Inner thigh (adductors)",
    leg_press_calf:"Calves: gastrocnemius", ab_wheel:"Abs (anti-extension)", pallof_press:"Obliques & deep core (anti-rotation)",
    side_plank:"Obliques (side of the core)", side_bend:"Obliques (side bending)"
  };

  // Best first for each muscle. The first group is shown as "Top pick"; when you filter the library or the
  // exercise picker by a muscle, built-in exercises are listed in this order.
  const best = {
    chest:[["bench","incline_press"],["dips","cable_fly","pushup"]],
    lats:[["pullup","lat_pulldown"],["db_row","cable_pullover"]],
    upper_back:[["chest_row"],["seated_row","barbell_row"]],
    traps:[["shrug"],["farmer_carry","y_raise"]],
    lower_back:[["back_extension"],["deadlift","good_morning"]],
    front_delts:[["shoulder_press"],["ohp","landmine_press"]],
    side_delts:[["lateral_raise"],["machine_lateral","upright_row"]],
    rear_delts:[["rear_delt"],["face_pull","rear_delt_row"]],
    biceps:[["incline_curl","preacher_curl"],["bayesian_curl","ez_curl","hammer_curl"]],
    triceps:[["oh_tri","skull_crusher"],["pressdown","close_grip_bench"]],
    forearms:[["wrist_curl","reverse_curl"],["wrist_extension","dead_hang"]],
    quads:[["squat","hack_press"],["leg_press","bss","leg_extension"]],
    hamstrings:[["leg_curl","rdl"],["lying_leg_curl","nordic_curl"]],
    glutes:[["hip_thrust","walking_lunge"],["cable_kickback","hip_abduction"]],
    adductors:[["hip_adduction"],["copenhagen","cable_adduction"]],
    calves:[["standing_calf"],["seated_calf","leg_press_calf"]],
    abs:[["cable_crunch","knee_raise"],["ab_wheel","weighted_plank"]],
    obliques:[["cable_woodchop","side_bend"],["pallof_press","side_plank"]]
  };
  exercises.forEach((e) => { e.focus = focus[e.id] || ""; });

  // Technique cues for a fresh install (existing users get them when they apply a program update).
  const cues = {
    lateral_raise:"Cable or dumbbell; keep tension at the bottom of the rep.",
    standing_calf:"Pause 1–2 s in the bottom stretch.",
    oh_tri:"Overhead position: more long-head growth than pressdowns.",
    cable_fly:"Set the pulleys high and pull down and in to bias the lower chest.",
    leg_extension:"Recline the seat or lean back: the rectus femoris grows more with the hips open."
  };
  exercises.forEach((e) => { if (!e.notes && cues[e.id]) e.notes = cues[e.id]; });

  const item = (exerciseId,sets,min,max,rest,priority="B",rirMin=1,rirMax=2,supersetGroup="",notes="") => ({
    id:`pi_${exerciseId}_${Math.random().toString(36).slice(2,6)}`,
    exerciseId,sets,min,max,rest,priority,rirMin,rirMax,supersetGroup,notes
  });

  // Revised October 2026: the same five sessions ordered Sun Legs A, Tue Shoulders + Arms, Wed Legs B,
  // Thu Chest + Triceps, Fri Back + Biceps, so no muscle is trained hard on consecutive days, plus the
  // muscles the first version under-trained (see programRevision below).
  const program = {
    id:"prog_strength_hypertrophy_5",
    name:"Strength + Hypertrophy 5-Day",
    description:"Strength anchors first, then body-part work. Sun Legs A · Tue Shoulders + Arms · Wed Legs B · Thu Chest + Triceps · Fri Back + Biceps.",
    createdAt:Date.now(),updatedAt:Date.now(),
    days:[
      {id:"day_legs_a",name:"Legs A — Quad Dominant",weekday:0,items:[
        item("squat",3,4,6,210,"A"),item("hack_press",3,8,12,150,"A"),item("leg_extension",3,10,15,90,"B"),
        item("leg_curl",3,8,12,105,"B"),item("hip_adduction",2,10,15,75,"C",1,2,"H"),item("hip_abduction",2,12,20,60,"C",1,2,"H"),item("standing_calf",3,8,15,75,"C"),item("knee_raise",2,8,15,75,"C")
      ]},
      {id:"day_shoulders",name:"Shoulders + Arms",weekday:2,items:[
        item("shoulder_press",3,6,10,150,"A"),item("lateral_raise",4,12,20,75,"A"),item("face_pull",2,12,20,75,"B"),
        item("incline_press",2,8,12,120,"B"),item("preacher_curl",3,8,12,75,"B"),item("oh_tri",3,8,12,90,"B"),item("shrug",2,10,15,75,"C")
      ]},
      {id:"day_legs_b",name:"Legs B — Posterior Chain + Back",weekday:3,items:[
        item("rdl",3,5,8,180,"A"),item("bss",3,8,12,120,"A"),item("leg_curl",3,8,12,105,"B"),
        item("seated_row",3,8,12,105,"B"),item("seated_calf",3,10,20,60,"C"),item("cable_crunch",3,10,15,75,"C"),item("cable_woodchop",2,10,15,60,"C")
      ]},
      {id:"day_chest",name:"Chest + Triceps",weekday:4,items:[
        item("bench",3,4,6,180,"A"),item("incline_press",3,8,12,120,"A"),item("cable_fly",2,10,15,90,"B"),
        item("oh_tri",3,8,12,90,"B"),item("pressdown",2,10,15,75,"C"),item("lateral_raise",4,12,20,75,"C")
      ]},
      {id:"day_back",name:"Back + Biceps",weekday:5,items:[
        item("pullup",3,5,8,180,"A"),item("chest_row",3,6,10,120,"A"),item("lat_pulldown",3,8,12,105,"B"),
        item("rear_delt",2,12,20,75,"B"),item("incline_curl",3,8,12,75,"B"),item("hammer_curl",2,10,15,75,"C"),
        item("wrist_curl",2,12,20,60,"C",1,2,"F"),item("reverse_curl",2,10,15,60,"C",1,2,"F")
      ]}
    ]
  };

  // Offered once to existing users (Train and Programs), applied only when they tap Apply.
  const programRevision = {
    id:"2026-10",
    label:"Oct 2026",
    title:"Revised 5-day program",
    summary:"Same five sessions, reordered so no muscle is trained hard two days in a row, plus the muscles the old version under-trained.",
    changes:[
      "New order: Sun Legs A · Tue Shoulders + Arms · Wed Legs B · Thu Chest + Triceps · Fri Back + Biceps. Week starts on Sunday.",
      "Side delts: 4 sets of lateral raises on Tuesday and Thursday (about 9.5 sets a week, up from 6.5).",
      "Calves: seated calf raise on Wednesday for the soleus, the part straight-knee raises miss.",
      "Adductors: hip adduction on Sunday. They're now tracked as a muscle.",
      "Front of the thigh: leg extension 3 sets (was 2). Lats: lat pulldown 3 sets (was 2).",
      "Abs: cable crunch replaces the weighted plank.",
      "Triceps: Tuesday uses the overhead extension instead of the pressdown.",
      "Shoulder health and traps: face pull replaces Tuesday's rear-delt fly, and 2 sets of shrugs are added.",
      "Forearms: wrist curl and reverse curl on Friday. Side of the hip: hip abduction on Sunday. Obliques: cable woodchop on Wednesday."
    ]
  };

  const legacyExerciseMap = {
    bench:"bench",incline_press:"incline_press",cable_fly:"cable_fly",oh_tri:"oh_tri",pressdown:"pressdown",
    lat_raise_mon:"lateral_raise",lat_raise_thu:"lateral_raise",pullup:"pullup",chest_row:"chest_row",lat_pulldown:"lat_pulldown",
    rear_delt_tue:"rear_delt",rear_delt_thu:"rear_delt",incline_curl:"incline_curl",hammer_curl:"hammer_curl",squat:"squat",
    hack_press:"hack_press",leg_extension:"leg_extension",leg_curl_a:"leg_curl",leg_curl_b:"leg_curl",calf_a:"standing_calf",calf_b:"standing_calf",
    knee_raise:"knee_raise",shoulder_press:"shoulder_press",incline_topup:"incline_press",preacher_curl:"preacher_curl",tri_thu:"pressdown",
    rdl:"rdl",bss:"bss",row_fri:"seated_row",plank:"weighted_plank"
  };
  const legacyProgramDayMap = {chest:"day_chest",back:"day_back",legsA:"day_legs_a",shoulders:"day_shoulders",legsB:"day_legs_b"};

  // Offered to people who already applied programRevision; added to their program, nothing replaced.
  const programAdditions = {
    id:"2026-10b",
    label:"Oct 2026",
    title:"Program additions",
    summary:"Completes the forearms, the side of the hip and the obliques. Adds to your current program; nothing is replaced.",
    changes:[
      "Friday: wrist curl and reverse curl, 2 sets each as a superset after hammer curls, for the forearm muscles curls don't reach.",
      "Sunday: hip abduction, 2 sets as a superset with hip adduction, for the glute medius.",
      "Wednesday: cable woodchop, 2 sets after cable crunches, for the obliques.",
      "Tips added to two exercises: cable fly set high-to-low for the lower chest; leg extension with the seat reclined for the rectus femoris."
    ],
    adds:[
      {dayId:"day_back", after:"hammer_curl", item:item("wrist_curl",2,12,20,60,"C",1,2,"F")},
      {dayId:"day_back", after:"wrist_curl", item:item("reverse_curl",2,10,15,60,"C",1,2,"F")},
      {dayId:"day_legs_a", after:"hip_adduction", item:item("hip_abduction",2,12,20,60,"C",1,2,"H"), pairWith:"hip_adduction"},
      {dayId:"day_legs_b", after:"cable_crunch", item:item("cable_woodchop",2,10,15,60,"C")}
    ],
    notes:{
      cable_fly:"Set the pulleys high and pull down and in to bias the lower chest.",
      leg_extension:"Recline the seat or lean back: the rectus femoris grows more with the hips open."
    }
  };

  return {muscles,targetRanges,exercises,best,program,programRevision,programAdditions,legacyExerciseMap,legacyProgramDayMap};
})();
