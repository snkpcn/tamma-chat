(() => {
  'use strict';

  const DATA = {
    en: {
      chaiyaphum:{title:'Silk, nature and foothill community life',description:'Chaiyaphum reveals Isan at an unhurried pace—from Ban Khwao weaving and local food to the landscapes around Tat Ton. Each experience leads back to real people and place.'},
      khonkaen:{title:'A contemporary city with strong community roots',description:'Khon Kaen brings together the rhythm of a regional city and the detail of surrounding communities, from Chonnabot Mudmee silk and Isan food to creative spaces where a new generation builds on inherited knowledge.'},
      buriram:{title:'Khmer stone heritage, volcanic soil and craft',description:'Buriram is shaped by its land and Khmer-Isan heritage. Ancient sites, food and textiles coloured by volcanic soil connect the province’s past with community life today.'},
      surin:{title:'Elephants, silver craft and many cultural roots',description:'Surin is home to Kuy, Khmer and Lao communities. Its character is expressed through elephants, Khwao Sinarin silver, textiles, food and the languages heard in everyday life.'},
      sisaket:{title:'Orchards, volcanic soil and borderland life',description:'Sisaket is known through fruit orchards on volcanic soil, community work and a diverse border culture. Its flavours and local goods are closely tied to season and landscape.'},
      nakhonratchasima:{title:'Gateway to Isan, a city surrounded by maker communities',description:'Nakhon Ratchasima combines Korat history, nature and craft communities such as Dan Kwian. One journey can include clay work, local food and the rural landscapes beyond the city.'},
      roiet:{title:'A calm city, silk and life around Thung Kula Rong Hai',description:'Roi Et brings together an easygoing city, temples, Saket silk and farming communities. Its simple pace helps reveal the way each local object grows from a particular way of life.'},
      mahasarakham:{title:'A learning city with practical handcraft',description:'Maha Sarakham links university life with communities across the fields. Basketry and reed mats carry knowledge passed through families and adapted for contemporary use.'},
      kalasin:{title:'Praewa silk, Phu Thai stories and ancient land',description:'Kalasin brings together Phu Thai culture, intricate Praewa silk and dinosaur learning sites—a province where both human skill and the deep history of the land are visible.'},
      sakonnakhon:{title:'Natural indigo, Nong Han and a slower rhythm',description:'Sakon Nakhon stands out for community indigo dyeing, agriculture and the atmosphere around Nong Han. Visitors can follow the process from preparing natural colour to weaving finished cloth.'},
      nakhonphanom:{title:'Mekong life, faith and weaving with its own rhythm',description:'Nakhon Phanom offers a quiet Mekong-city experience through temples, diverse ethnic communities and distinctive Muk weaving. The province is calm, but full of stories.'},
      mukdahan:{title:'A Mekong city where both banks remain connected',description:'Mukdahan is shaped by the Mekong, markets and Phu Thai communities. Nong Sung mud-treated textiles show how local knowledge begins with materials and environment close to home.'},
      yasothon:{title:'Organic rice fields, festivals and Isan humour',description:'Yasothon is told through organic jasmine rice, farming communities and living traditions. Its character is relaxed and friendly, revealing the close relationship between people and the seasons.'},
      amnatcharoen:{title:'A small city where weaving and community stay close',description:'Amnat Charoen suits a slower way of discovering Isan. Khit weaving, agricultural life and warm community hospitality make each stop personal and grounded.'},
      ubonratchathani:{title:'First light by the Mekong, candle craft and Kab Bua cloth',description:'Ubon Ratchathani brings together riverside nature, art, faith and skilled making. Kab Bua textiles, food and candle craft reveal refinement woven into everyday local life.'},
      udonthani:{title:'Ban Chiang heritage and the energy of modern Isan',description:'Udon Thani connects Ban Chiang archaeology with markets, food and contemporary city life. The familiar pottery patterns are more than decoration—they carry the memory of place.'},
      nongkhai:{title:'A Mekong city where faith and river move together',description:'Nong Khai has the calm rhythm of a river city, Naga stories, temples and community textiles. It rewards slow observation and conversations with local people.'},
      buengkan:{title:'Forest, rock, river and communities of a young province',description:'Bueng Kan is framed by the Mekong, forests and dramatic rock landscapes. Community food and household goods reflect nearby ingredients and the ways people adapt to their environment.'},
      loei:{title:'Mountains, cool air and the colour of Phi Ta Khon',description:'Loei combines mountain towns, old communities and vivid traditions. Phi Ta Khon masks, basketry and local food make the journey playful while keeping community roots clearly visible.'},
      nongbualamphu:{title:'Mountains, textiles and quiet community life',description:'Nong Bua Lamphu invites travellers off the main route into nature, lotus-pattern textiles and close-knit communities. Its strength is a sense of calm and stories told directly by makers.'}
    },
    zh: {
      chaiyaphum:{title:'丝绸、自然与山麓社区生活',description:'猜也蓬以从容的节奏展现伊森：从班考织造、地方饮食，到 Tat Ton 周边的自然景观，每段体验最终都回到真实的人与土地。'},
      khonkaen:{title:'现代城市与深厚社区根脉',description:'孔敬把区域城市的活力与周边社区的细腻连在一起，从 Chonnabot 扎染丝绸、伊森饮食，到年轻一代延续传统知识的创意空间。'},
      buriram:{title:'高棉石迹、火山土与手艺',description:'武里南的故事来自土地与高棉—伊森文化。古迹、食物和以火山土染色的织物，让过去与今天的社区生活彼此相连。'},
      surin:{title:'大象、银器与多重文化根源',description:'素林有 Kuy、高棉与老挝族群共同生活。大象、Khwao Sinarin 银器、织物、饮食与日常语言共同形成这里独特的文化面貌。'},
      sisaket:{title:'果园、火山土与边境生活',description:'四色菊通过火山土上的果园、社区工作与多元边境文化展现自己。这里的味道与地方好物都紧密跟随季节和地貌。'},
      nakhonratchasima:{title:'伊森门户与环绕城市的匠人社区',description:'呵叻把城市历史、自然与 Dan Kwian 等手艺社区连接起来，一趟旅程可以同时认识陶土、地方饮食与城市之外的乡村。'},
      roiet:{title:'宁静城市、丝绸与 Thung Kula Rong Hai 的田野生活',description:'黎逸有容易亲近的城市节奏、寺庙、Saket 丝绸与农业社区。这里的朴素感让人更容易看见每件物品来自怎样的生活方式。'},
      mahasarakham:{title:'学习之城与真正实用的手工艺',description:'玛哈沙拉堪把大学城市生活与田野社区连接起来。篮编与芦席保存着家族传承的知识，也不断被调整成适合今天使用的形式。'},
      kalasin:{title:'Praewa 丝绸、Phu Thai 故事与远古土地',description:'加拉信拥有 Phu Thai 文化、精细的 Praewa 丝绸和恐龙学习遗址，在这里既能看见人的手艺，也能读到土地深远的历史。'},
      sakonnakhon:{title:'天然靛蓝、Nong Han 与慢下来的生活',description:'沙功那空以社区天然靛染、农业和 Nong Han 周边氛围闻名。旅程可以从准备天然染料一路看到布匹被织成成品。'},
      nakhonphanom:{title:'湄公河生活、信仰与独特织造节奏',description:'那空拍侬通过寺庙、多元族群社区与独特的 Muk 织物，让人感受宁静的湄公河城市生活；节奏安静，却处处有故事。'},
      mukdahan:{title:'两岸文化仍然相连的湄公河城市',description:'穆达汉的生活与湄公河、市场和 Phu Thai 社区紧密相连。Nong Sung 泥染布说明地方智慧往往从身边的材料与环境开始。'},
      yasothon:{title:'有机稻田、节庆与伊森幽默',description:'益梭通的故事来自有机茉莉香米、农业社区与仍在生活中的传统。这里轻松亲切，也让人清楚看见人与季节的关系。'},
      amnatcharoen:{title:'小城、织造与彼此靠近的社区',description:'安纳乍能适合放慢速度认识伊森。Khit 织物、农业生活与真诚的社区接待，让每一个停留点都更私人、更真实。'},
      ubonratchathani:{title:'湄公河晨光、蜡烛工艺与 Kab Bua 织物',description:'乌汶把河岸自然、艺术、信仰与手艺放在一起。Kab Bua 织物、饮食和蜡烛工艺，都能看见当地日常生活中的细致。'},
      udonthani:{title:'Ban Chiang 古文明与现代伊森活力',description:'乌隆把 Ban Chiang 考古遗产与市场、饮食和现代城市生活连接起来。熟悉的陶器纹样不只是装饰，也是土地记忆的一部分。'},
      nongkhai:{title:'信仰与河流同行的湄公河城市',description:'廊开有河城缓慢的节奏、娜迦故事、寺庙和社区织物。这里适合慢慢观察细节，并直接听当地人讲自己的故事。'},
      buengkan:{title:'森林、岩石、河流与年轻省份的社区',description:'汶干以湄公河、森林和岩石地貌为主要背景。社区食物与日用品反映身边的原料，也体现人们如何适应自己的环境。'},
      loei:{title:'群山、凉意与 Phi Ta Khon 的色彩',description:'黎府拥有山城、老社区与鲜明的传统。Phi Ta Khon 面具、编织与地方饮食让旅程充满乐趣，同时保留清楚的社区根源。'},
      nongbualamphu:{title:'群山、织物与安静的社区生活',description:'农磨兰普邀请人离开主干路线，走进自然、莲花纹织物与亲密的社区。它的魅力在于安静，以及由制作者亲口讲出的故事。'}
    },
    lo: {
      chaiyaphum:{title:'ຜືນໄໝ ທຳມະຊາດ ແລະ ວິຖີຊຸມຊົນເຊີງພູ',description:'ໄຊຍະພູມຊວນໃຫ້ຮູ້ຈັກອີສານແບບຄ່ອຍເປັນຄ່ອຍໄປ ຈາກງານທໍບ້ານເຂວ້າ ອາຫານທ້ອງຖິ່ນ ໄປຫາທຳມະຊາດຮອບ Tat Ton; ທຸກປະສົບການເຊື່ອມກັບຄົນ ແລະ ພື້ນທີ່ຈິງ.'},
      khonkaen:{title:'ເມືອງຮ່ວມສະໄໝທີ່ຍັງເຫັນຮາກຊຸມຊົນ',description:'ຂອນແກ່ນມີທັງຈັງຫວະຂອງເມືອງໃຫຍ່ ແລະ ຄວາມລະອຽດຂອງຊຸມຊົນຮອບນອກ ຈາກຜ້າໄໝຊົນນະບົດ ອາຫານອີສານ ເຖິງພື້ນທີ່ສ້າງສັນຂອງຄົນຮຸ່ນໃໝ່.'},
      buriram:{title:'ຮ່ອງຮອຍປາສາດຫີນ ດິນພູໄຟ ແລະ ງານຝີມື',description:'ບຸຣີຣຳເລົ່າເລື່ອງຜ່ານຜືນດິນ ແລະ ວັດທະນະທຳຂະແມອີສານ. ໂບຮານສະຖານ ອາຫານ ແລະ ຜ້າສີດິນພູໄຟເຊື່ອມອະດີດກັບຊີວິດຊຸມຊົນມື້ນີ້.'},
      surin:{title:'ແຜ່ນດິນຊ້າງ ງານເງິນ ແລະ ຫຼາຍຮາກວັດທະນະທຳ',description:'ສຸຣິນມີຊຸມຊົນກູຍ ຂະແມ ແລະ ລາວຢູ່ຮ່ວມກັນ. ອັດລັກຂອງພື້ນທີ່ຈຶ່ງຢູ່ໃນເລື່ອງຊ້າງ ງານເງິນ Khwao Sinarin ຜ້າ ອາຫານ ແລະ ພາສາ.'},
      sisaket:{title:'ສວນໝາກໄມ້ ດິນພູໄຟ ແລະ ວິຖີຊາຍແດນ',description:'ສີສະເກດມີສວນໝາກໄມ້ເທິງດິນພູໄຟ ງານຊຸມຊົນ ແລະ ວັດທະນະທຳຊາຍແດນທີ່ຫຼາກຫຼາຍ; ລົດຊາດ ແລະ ຂອງດີຈຶ່ງຜູກກັບລະດູການ ແລະ ພູມສັນຖານ.'},
      nakhonratchasima:{title:'ປະຕູສູ່ອີສານ ເມືອງໃຫຍ່ທີ່ລ້ອມດ້ວຍຊຸມຊົນຊ່າງ',description:'ນະຄອນຣາຊະສີມາລວມປະຫວັດສາດໂຄຣາດ ທຳມະຊາດ ແລະ ຊຸມຊົນຊ່າງເຊັ່ນ Dan Kwian; ໜຶ່ງການເດີນທາງຈຶ່ງໄດ້ທັງງານດິນ ອາຫານ ແລະ ຊົນນະບົດ.'},
      roiet:{title:'ເມືອງສະຫງົບ ງານໄໝ ແລະ ຊີວິດຮອບທົ່ງກຸລາ',description:'ຮ້ອຍເອັດມີຈັງຫວະເມືອງທີ່ສະບາຍ ວັດ ຜ້າໄໝ Saket ແລະ ຊຸມຊົນກະສິກຳ; ຄວາມຮຽບງ່າຍຊ່ວຍໃຫ້ເຫັນທີ່ມາຂອງຂອງແຕ່ລະຊິ້ນ.'},
      mahasarakham:{title:'ເມືອງແຫ່ງການຮຽນຮູ້ກັບງານມືທີ່ໃຊ້ໄດ້ຈິງ',description:'ມະຫາສາຣະຄາມເຊື່ອມເມືອງມະຫາວິທະຍາໄລກັບຊຸມຊົນຮອບທົ່ງ. ງານສານ ແລະ ເສື່ອກົກເກັບຄວາມຮູ້ຈາກຄອບຄົວ ແລະ ປັບໃຫ້ເຂົ້າກັບຊີວິດປັດຈຸບັນ.'},
      kalasin:{title:'ຜ້າແພວາ ເລື່ອງຜູ້ໄທ ແລະ ແຜ່ນດິນດຶກດຳບັນ',description:'ກາລະສິນມີວັດທະນະທຳຜູ້ໄທ ຜ້າແພວາທີ່ລະອຽດ ແລະ ແຫຼ່ງຮຽນຮູ້ໄດໂນເສົາ; ຈຶ່ງເຫັນທັງຝີມືຄົນ ແລະ ເລື່ອງຂອງຜືນດິນ.'},
      sakonnakhon:{title:'ຄາມທຳມະຊາດ Nong Han ແລະ ຊີວິດທີ່ຊ້າລົງ',description:'ສະກົນນະຄອນໂດດເດັ່ນດ້ວຍງານຍ້ອມຄາມຊຸມຊົນ ວິຖີກະສິກຳ ແລະ ບັນຍາກາດຮອບ Nong Han; ສາມາດເຫັນຕັ້ງແຕ່ການກຽມສີຈົນເຖິງຜ້າສຳເລັດ.'},
      nakhonphanom:{title:'ຊີວິດຮິມໂຂງ ສັດທາ ແລະ ງານທໍທີ່ມີຈັງຫວະຂອງຕົນ',description:'ນະຄອນພະນົມຊວນສຳຜັດເມືອງຮິມໂຂງຜ່ານວັດ ຊຸມຊົນຫຼາຍຊາດພັນ ແລະ ຜ້າມຸກທີ່ມີລາຍສະເພາະ; ສະຫງົບແຕ່ເຕັມໄປດ້ວຍເລື່ອງລາວ.'},
      mukdahan:{title:'ເມືອງຮິມໂຂງທີ່ສອງຝັ່ງຍັງເຊື່ອມກັນ',description:'ມຸກດາຫານຜູກກັບແມ່ນ້ຳໂຂງ ຕະຫຼາດ ແລະ ຊຸມຊົນຜູ້ໄທ. ຜ້າໝັກໂຄນ Nong Sung ສະແດງວ່າພູມປັນຍາທ້ອງຖິ່ນເລີ່ມຈາກວັດສະດຸ ແລະ ສິ່ງແວດລ້ອມໃກ້ຕົວ.'},
      yasothon:{title:'ທົ່ງເຂົ້າອິນຊີ ງານບຸນ ແລະ ອາລົມຂັນແບບອີສານ',description:'ຍະໂສທອນເລົ່າເລື່ອງຜ່ານເຂົ້າຫອມມະລິອິນຊີ ຊຸມຊົນກະສິກຳ ແລະ ປະເພນີທີ່ຍັງມີຊີວິດ; ຮຽບງ່າຍ ເປັນກັນເອງ ແລະ ເຫັນຄວາມສຳພັນຂອງຄົນກັບລະດູການ.'},
      amnatcharoen:{title:'ເມືອງນ້ອຍທີ່ງານທໍ ແລະ ຊຸມຊົນຍັງໃກ້ຊິດ',description:'ອຳນາດຈະເລີນເໝາະກັບການຮູ້ຈັກອີສານແບບບໍ່ຮີບຮ້ອນ. ຜ້າຂິດ ວິຖີກະສິກຳ ແລະ ການຕ້ອນຮັບຂອງຊຸມຊົນເຮັດໃຫ້ແຕ່ລະຈຸດໝາຍຮູ້ສຶກເປັນສ່ວນຕົວ.'},
      ubonratchathani:{title:'ແສງທຳອິດຮິມໂຂງ ງານທຽນ ແລະ ຜ້າ Kab Bua',description:'ອຸບົນຣາຊະທານີລວມທຳມະຊາດຮິມນ້ຳ ສິລະປະ ສັດທາ ແລະ ງານຊ່າງ. ຜ້າ Kab Bua ອາຫານ ແລະ ງານທຽນສະແດງຄວາມປະນີດໃນຊີວິດປະຈຳວັນ.'},
      udonthani:{title:'ອະດີດ Ban Chiang ກັບພະລັງຂອງອີສານຍຸກໃໝ່',description:'ອຸດອນທານີເຊື່ອມໂບຮານຄະດີ Ban Chiang ກັບຕະຫຼາດ ອາຫານ ແລະ ຊີວິດເມືອງຮ່ວມສະໄໝ. ລາຍເຄື່ອງປັ້ນບໍ່ແມ່ນພຽງການຕົກແຕ່ງ ແຕ່ແມ່ນຄວາມຈື່ຈຳຂອງພື້ນທີ່.'},
      nongkhai:{title:'ເມືອງຮິມໂຂງທີ່ສັດທາ ແລະ ສາຍນ້ຳເດີນໄປນຳກັນ',description:'ໜອງຄາຍມີຈັງຫວະສະຫງົບຂອງເມືອງຮິມນ້ຳ ເລື່ອງພະຍານາກ ວັດ ແລະ ຜ້າຊຸມຊົນ; ເໝາະກັບການຄ່ອຍໆ ເບິ່ງລາຍລະອຽດ ແລະ ຟັງເລື່ອງຈາກຄົນທ້ອງຖິ່ນ.'},
      buengkan:{title:'ປ່າ ຫີນ ສາຍນ້ຳ ແລະ ຊຸມຊົນຂອງແຂວງໜຸ່ມ',description:'ບຶງການມີແມ່ນ້ຳໂຂງ ປ່າ ແລະ ພູມປະເທດຫີນເປັນສາກຫຼັກ. ອາຫານ ແລະ ຂອງໃຊ້ຊຸມຊົນສະທ້ອນວັດຖຸດິບໃກ້ບ້ານ ແລະ ການປັບຕົວກັບພື້ນທີ່.'},
      loei:{title:'ພູເຂົາ ອາກາດເຢັນ ແລະ ສີສັນຂອງ Phi Ta Khon',description:'ເລີຍມີເມືອງພູເຂົາ ຊຸມຊົນເກົ່າ ແລະ ປະເພນີທີ່ເຕັມໄປດ້ວຍສີສັນ. ໜ້າກາກ Phi Ta Khon ງານສານ ແລະ ອາຫານທ້ອງຖິ່ນເຮັດໃຫ້ການເດີນທາງສົນຸກ ແຕ່ຍັງເຫັນຮາກຊຸມຊົນ.'},
      nongbualamphu:{title:'ພູເຂົາ ຜືນຜ້າ ແລະ ຊີວິດຊຸມຊົນຮຽບງ່າຍ',description:'ໜອງບົວລຳພູຊວນອອກຈາກເສັ້ນທາງຫຼັກໄປພົບທຳມະຊາດ ຜ້າລາຍບົວ ແລະ ຊຸມຊົນທີ່ໃກ້ຊິດກັນ; ເສະເໜ່ຢູ່ທີ່ຄວາມສະຫງົບ ແລະ ເລື່ອງທີ່ຄົນເຮັດເລົ່າເອງ.'}
    },
    vi: {
      chaiyaphum:{title:'Lụa, thiên nhiên và đời sống cộng đồng vùng chân núi',description:'Chaiyaphum mở ra Isan với nhịp chậm rãi: từ nghề dệt Ban Khwao, món ăn địa phương đến thiên nhiên quanh Tat Ton. Mỗi trải nghiệm đều dẫn trở lại với con người và vùng đất thật.'},
      khonkaen:{title:'Thành phố hiện đại với gốc cộng đồng rõ nét',description:'Khon Kaen kết hợp nhịp sống của một đô thị vùng với sự tinh tế của các cộng đồng xung quanh, từ lụa Mudmee Chonnabot và ẩm thực Isan đến những không gian sáng tạo nơi thế hệ mới tiếp nối tri thức cũ.'},
      buriram:{title:'Dấu tích đền đá, đất núi lửa và nghề thủ công',description:'Buriram kể chuyện qua đất đai và di sản Khmer-Isan. Di tích cổ, ẩm thực và vải nhuộm từ đất núi lửa nối quá khứ với đời sống cộng đồng hôm nay.'},
      surin:{title:'Vùng đất voi, nghề bạc và nhiều cội nguồn văn hóa',description:'Surin là nơi cộng đồng Kuy, Khmer và Lào cùng sinh sống. Voi, bạc Khwao Sinarin, dệt may, ẩm thực và ngôn ngữ đời thường cùng tạo nên bản sắc riêng của tỉnh.'},
      sisaket:{title:'Vườn cây, đất núi lửa và đời sống biên giới',description:'Sisaket được nhận biết qua các vườn cây trên đất núi lửa, nghề cộng đồng và văn hóa biên giới đa dạng. Hương vị và sản vật nơi đây gắn chặt với mùa vụ và địa hình.'},
      nakhonratchasima:{title:'Cửa ngõ Isan, thành phố lớn giữa các cộng đồng thợ thủ công',description:'Nakhon Ratchasima kết hợp lịch sử Korat, thiên nhiên và các làng nghề như Dan Kwian. Một hành trình có thể đi từ nghề đất, món ăn đến vùng nông thôn ngoài thành phố.'},
      roiet:{title:'Thành phố yên bình, lụa và đời sống quanh Thung Kula Rong Hai',description:'Roi Et có nhịp thành phố dễ chịu, chùa chiền, lụa Saket và cộng đồng nông nghiệp. Sự giản dị giúp người đi thấy rõ mỗi món đồ sinh ra từ lối sống nào.'},
      mahasarakham:{title:'Thành phố học tập với nghề thủ công hữu dụng',description:'Maha Sarakham nối đời sống đại học với các cộng đồng quanh đồng ruộng. Nghề đan và chiếu cói lưu giữ kiến thức truyền trong gia đình và được điều chỉnh cho cuộc sống hôm nay.'},
      kalasin:{title:'Lụa Praewa, câu chuyện Phu Thai và vùng đất cổ xưa',description:'Kalasin có văn hóa Phu Thai, lụa Praewa tinh xảo và các điểm học về khủng long—một nơi cho thấy cả tay nghề con người lẫn lịch sử sâu xa của đất.'},
      sakonnakhon:{title:'Chàm tự nhiên, Nong Han và nhịp sống chậm',description:'Sakon Nakhon nổi bật với nghề nhuộm chàm cộng đồng, nông nghiệp và không khí quanh Nong Han. Du khách có thể thấy cả hành trình từ chuẩn bị màu tự nhiên đến dệt thành tấm vải.'},
      nakhonphanom:{title:'Đời sống sông Mekong, đức tin và nhịp dệt riêng',description:'Nakhon Phanom cho cảm giác của một thành phố Mekong yên tĩnh qua chùa chiền, nhiều cộng đồng dân tộc và vải Muk đặc trưng. Nhịp sống nhẹ nhưng đầy câu chuyện.'},
      mukdahan:{title:'Thành phố Mekong nơi hai bờ vẫn gắn kết',description:'Mukdahan gắn với sông Mekong, chợ và cộng đồng Phu Thai. Vải xử lý bùn Nong Sung cho thấy tri thức địa phương bắt đầu từ vật liệu và môi trường ngay quanh mình.'},
      yasothon:{title:'Ruộng lúa hữu cơ, lễ hội và nét hài hước Isan',description:'Yasothon được kể qua gạo thơm jasmine hữu cơ, cộng đồng nông nghiệp và những truyền thống vẫn sống trong hiện tại. Không khí giản dị, thân thiện làm rõ mối quan hệ giữa con người với mùa vụ.'},
      amnatcharoen:{title:'Thành phố nhỏ nơi nghề dệt và cộng đồng vẫn gần nhau',description:'Amnat Charoen hợp với cách khám phá Isan không vội. Dệt Khit, đời sống nông nghiệp và sự đón tiếp chân thành của cộng đồng khiến mỗi điểm dừng trở nên gần gũi.'},
      ubonratchathani:{title:'Ánh sáng đầu ngày bên Mekong, nghề nến và vải Kab Bua',description:'Ubon Ratchathani kết hợp thiên nhiên ven sông, nghệ thuật, đức tin và nghề thủ công. Vải Kab Bua, ẩm thực và nghề nến cho thấy sự tinh tế trong đời sống thường ngày.'},
      udonthani:{title:'Di sản Ban Chiang và năng lượng của Isan hiện đại',description:'Udon Thani nối khảo cổ Ban Chiang với chợ, ẩm thực và đời sống thành phố đương đại. Những hoa văn gốm quen thuộc không chỉ để trang trí mà còn là ký ức của vùng đất.'},
      nongkhai:{title:'Thành phố Mekong nơi đức tin đi cùng dòng nước',description:'Nong Khai có nhịp yên của thành phố ven sông, chuyện Naga, chùa và dệt may cộng đồng. Nơi đây hợp để nhìn thật chậm và nghe câu chuyện trực tiếp từ người địa phương.'},
      buengkan:{title:'Rừng, đá, dòng sông và cộng đồng của một tỉnh trẻ',description:'Bueng Kan lấy Mekong, rừng và địa hình đá làm khung cảnh chính. Thực phẩm và vật dụng cộng đồng phản ánh nguyên liệu gần nhà và cách con người thích nghi với môi trường.'},
      loei:{title:'Núi, không khí mát và sắc màu Phi Ta Khon',description:'Loei có thị trấn miền núi, cộng đồng lâu đời và truyền thống đầy màu sắc. Mặt nạ Phi Ta Khon, đồ đan và ẩm thực khiến chuyến đi vui mà vẫn nhìn rõ gốc cộng đồng.'},
      nongbualamphu:{title:'Núi, dệt may và đời sống cộng đồng bình dị',description:'Nong Bua Lamphu mời người đi rời khỏi tuyến chính để gặp thiên nhiên, vải hoa sen và cộng đồng gắn bó. Điểm mạnh là sự yên tĩnh và những câu chuyện được chính người làm kể lại.'}
    }
  };

  const FIRST_WAVE=window.THAMMACHAT_FIRST_WAVE_LANGUAGE_PACKS?.provinces||{};
  for(const language of ['ja','ko'])if(FIRST_WAVE[language])DATA[language]=FIRST_WAVE[language];

  function get(provinceId, lang, fallback={}) {
    if (!lang || lang === 'th') return fallback;
    const english = DATA.en?.[provinceId] || {};
    const row = DATA[lang]?.[provinceId] || {};
    return { ...fallback, ...english, ...row };
  }

  window.OTOP_PROVINCE_TRANSLATIONS = { get };
})();
