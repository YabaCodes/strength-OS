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
    E("shrug","Shrug","traps",[],"Dumbbell / Machine","weight_reps",10,15,75,2.5,"Straight up and down; pause at the top.")
  ];

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
        item("leg_curl",3,8,12,105,"B"),item("hip_adduction",2,10,15,75,"C"),item("standing_calf",3,8,15,75,"C"),item("knee_raise",2,8,15,75,"C")
      ]},
      {id:"day_shoulders",name:"Shoulders + Arms",weekday:2,items:[
        item("shoulder_press",3,6,10,150,"A"),item("lateral_raise",4,12,20,75,"A"),item("face_pull",2,12,20,75,"B"),
        item("incline_press",2,8,12,120,"B"),item("preacher_curl",3,8,12,75,"B"),item("oh_tri",3,8,12,90,"B"),item("shrug",2,10,15,75,"C")
      ]},
      {id:"day_legs_b",name:"Legs B — Posterior Chain + Back",weekday:3,items:[
        item("rdl",3,5,8,180,"A"),item("bss",3,8,12,120,"A"),item("leg_curl",3,8,12,105,"B"),
        item("seated_row",3,8,12,105,"B"),item("seated_calf",3,10,20,60,"C"),item("cable_crunch",3,10,15,75,"C")
      ]},
      {id:"day_chest",name:"Chest + Triceps",weekday:4,items:[
        item("bench",3,4,6,180,"A"),item("incline_press",3,8,12,120,"A"),item("cable_fly",2,10,15,90,"B"),
        item("oh_tri",3,8,12,90,"B"),item("pressdown",2,10,15,75,"C"),item("lateral_raise",4,12,20,75,"C")
      ]},
      {id:"day_back",name:"Back + Biceps",weekday:5,items:[
        item("pullup",3,5,8,180,"A"),item("chest_row",3,6,10,120,"A"),item("lat_pulldown",3,8,12,105,"B"),
        item("rear_delt",2,12,20,75,"B"),item("incline_curl",3,8,12,75,"B"),item("hammer_curl",2,10,15,75,"C")
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
      "Shoulder health and traps: face pull replaces Tuesday's rear-delt fly, and 2 sets of shrugs are added."
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

  return {muscles,targetRanges,exercises,program,programRevision,legacyExerciseMap,legacyProgramDayMap};
})();
