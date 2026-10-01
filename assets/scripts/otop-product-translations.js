(() => {
  'use strict';
  const T = {
    en: {
      'chaiyaphum-otop-001': {
        name:'Ban Khwao Mudmee Silk', originPlace:'Ban Khwao', makerType:'Community silk weavers',
        coreValue:'A cloth that carries the time and skill of Ban Khwao',
        materialOrIngredient:'Silk yarn',
        craftProcess:'Tie the pattern → dye the silk → hand-weave on a loom',
        whyHere:'Ban Khwao is renowned for Mudmee silk and its living weaving tradition.',
        shortDescription:'Ban Khwao Mudmee silk begins with tied patterns, dyed silk yarn and patient hand-weaving. Each piece carries the rhythm of the weaver and the identity of Ban Khwao.',
        imageCaption:'Silk that tells Ban Khwao’s story through the hands of its weavers'
      },
      'chaiyaphum-otop-002': {
        name:'Upcycled Silk Patchwork Hat', originPlace:'Ban Khwao', makerType:'Community textile group',
        coreValue:'Let no beautiful piece of silk go to waste',
        materialOrIngredient:'Silk offcuts',
        craftProcess:'Sort silk offcuts → patch together → sew into a hat',
        whyHere:'It extends Ban Khwao’s silk tradition into a practical contemporary object.',
        shortDescription:'Silk offcuts from weaving are collected, pieced together and sewn into wearable hats. Every piece is different, giving the remaining silk a useful second life.',
        imageCaption:'Silk remnants given a new life as an everyday object'
      },
      'chaiyaphum-otop-003': {
        name:'Nok Krajib Crispy Banana', originPlace:'Ban Nong Bo', makerType:'Community food-processing group',
        coreValue:'A local harvest turned into a community snack',
        materialOrIngredient:'Banana',
        craftProcess:'Select bananas → slice thin → fry crisp → coat with flavour',
        whyHere:'A community product that preserves nearby produce and adds value to what is grown locally.',
        shortDescription:'Locally grown bananas are transformed into a crisp, sweet snack that keeps longer. It is a simple product that reflects the work of the community and the value added to local harvests.',
        imageCaption:'Local bananas transformed into a community-made snack'
      },
      'chaiyaphum-otop-004': {
        name:'Community Fabric Tote Bag', originPlace:'Ban Lat Wang Muang, Nong Bua Daeng', makerType:'Community sewing group',
        coreValue:'Community textile craft made for everyday use',
        materialOrIngredient:'Fabric',
        craftProcess:'Choose fabric → cut the form → sew together → finish for daily use',
        whyHere:'It reflects local sewing skills and product development in Nong Bua Daeng.',
        shortDescription:'This fabric bag carries the handwork of Ban Lat Wang Muang into daily life. It is cut and sewn for practical use, with the maker’s care visible in every seam.',
        imageCaption:'A practical bag that carries community craft beyond the village'
      },
      'chaiyaphum-otop-005': {
        name:'Dried Makrut Lime Deodorizer', originPlace:'Chatturat', makerType:'Community herbal-product group',
        coreValue:'A familiar local herb turned into a useful household object',
        materialOrIngredient:'Makrut lime',
        craftProcess:'Select limes → cut → sun-dry or dehydrate → pack',
        whyHere:'It turns a familiar local herb into a simple product for everyday use.',
        shortDescription:'Makrut lime, familiar from the kitchen, is dried so it keeps longer and retains its fresh citrus aroma. It becomes a simple household product rooted in a herb people already know well.',
        imageCaption:'The fresh scent of makrut lime in a simple everyday form'
      },
      'chaiyaphum-otop-006': {
        name:'Chaiyaphum Mam Fermented Sausage', originPlace:'Chaiyaphum', makerType:'Local food makers',
        coreValue:'A fermented food whose flavour depends on time',
        materialOrIngredient:'Meat and local seasonings',
        craftProcess:'Season the meat → ferment → allow the flavour to develop',
        whyHere:'Mam is closely tied to Isan traditions of preserving meat through fermentation.',
        shortDescription:'Chaiyaphum mam is a local fermented food that cannot be rushed. Meat and seasonings are left to develop their flavour over time, giving the province one of its most recognisable tastes.',
        imageCaption:'A local fermented food whose flavour is shaped by time'
      },
      'chaiyaphum-otop-007': {
        name:'Pla Ra Bong / Jaew Bong', originPlace:'Chaiyaphum', makerType:'Local food makers',
        coreValue:'The flavour of the Isan kitchen, made to keep',
        materialOrIngredient:'Fermented fish and herbs',
        craftProcess:'Season fermented fish → mix with herbs → prepare ready to eat',
        whyHere:'Pla ra and jaew bong are part of Isan food preservation and the everyday culture of eating sticky rice.',
        shortDescription:'Pla ra bong starts with fermented fish and local herbs, seasoned until aromatic and easy to eat. More than a dip, it is a familiar taste of the Isan kitchen and sticky-rice meals.',
        imageCaption:'The deep savoury taste of the Isan kitchen beside sticky rice'
      },
      'chaiyaphum-otop-008': {
        name:'Community Health Rice', originPlace:'Chaiyaphum', makerType:'Chaiyaphum rice-processing group',
        coreValue:'Adding value back to the rice field',
        materialOrIngredient:'Rice',
        craftProcess:'Select rice → process → pack for convenient use',
        whyHere:'It develops local farmers’ harvests into products suited to contemporary eating habits.',
        shortDescription:'Rice grown by local farmers is selected and processed for modern everyday use. Its value is not only in the grain, but in returning more value to the people who grow it.',
        imageCaption:'Rice from local fields given new value'
      },
      'chaiyaphum-otop-009': {
        name:'Handwoven Sticky Rice Basket', originPlace:'Chaiyaphum', makerType:'Community basket weavers',
        coreValue:'A vessel born from the culture of eating sticky rice',
        materialOrIngredient:'Bamboo or natural fibre',
        craftProcess:'Split natural material → weave the form → finish lid and base',
        whyHere:'The sticky-rice basket is inseparable from the everyday food culture of Isan.',
        shortDescription:'Natural material is split into fine strips and woven layer by layer into a basket that keeps sticky rice warm. This everyday object carries time, skill and the warmth of a home meal.',
        imageCaption:'A simple vessel that keeps both sticky rice and the warmth of a meal'
      },
      'chaiyaphum-otop-010': {
        name:'Herbal Balm / Massage Oil', originPlace:'Chaiyaphum', makerType:'Community herbal-product makers',
        coreValue:'Traditional self-care knowledge in a portable form',
        materialOrIngredient:'Local herbs',
        craftProcess:'Select herbs → extract or simmer → blend into balm or oil',
        whyHere:'It turns familiar local herbal knowledge into a practical product for everyday life.',
        shortDescription:'Herbal balm and massage oil bring familiar community self-care knowledge into a small, portable format that can stay at home, in the car or in a bag.',
        imageCaption:'Local herbal knowledge made easy to carry'
      }
    },
    zh: {
      'chaiyaphum-otop-001': {
        name:'班考手工扎染丝绸', originPlace:'班考', makerType:'社区丝织工匠',
        coreValue:'一块布里保存着班考的时间与手艺',
        materialOrIngredient:'丝线',
        craftProcess:'扎纹 → 染丝 → 上机手织',
        whyHere:'班考以扎染丝绸与仍在延续的地方织造传统闻名。',
        shortDescription:'班考扎染丝绸从扎纹、染丝开始，再由织工耐心手织成布。每一匹都保留着织工的节奏，也带着班考独有的身份。',
        imageCaption:'由织工双手讲述班考故事的丝绸'
      },
      'chaiyaphum-otop-002': {
        name:'再生丝绸拼布帽', originPlace:'班考', makerType:'社区纺织小组',
        coreValue:'不让任何一块漂亮丝绸被浪费',
        materialOrIngredient:'丝绸边角料',
        craftProcess:'挑选边角料 → 拼接 → 缝制成帽',
        whyHere:'把班考的丝绸传统延伸成当代、实用的日常物件。',
        shortDescription:'织造留下的丝绸边角料被重新挑选、拼接并缝成可佩戴的帽子。每一顶颜色与纹样都不同，让剩余的丝绸得到第二次生命。',
        imageCaption:'让丝绸边角料重新成为日常用品'
      },
      'chaiyaphum-otop-003': {
        name:'Nok Krajib 香脆香蕉片', originPlace:'班农博', makerType:'社区食品加工小组',
        coreValue:'把家门口的收成变成社区零食',
        materialOrIngredient:'香蕉',
        craftProcess:'挑香蕉 → 薄切 → 炸脆 → 调味',
        whyHere:'把本地原料加工得更耐保存，同时提升社区农产价值。',
        shortDescription:'本地香蕉被加工成香脆、微甜、方便保存的零食。它简单，却能看见社区成员的劳动与地方农产被重新赋值的过程。',
        imageCaption:'把本地香蕉做成社区风味零食'
      },
      'chaiyaphum-otop-004': {
        name:'社区布艺多用途包', originPlace:'Ban Lat Wang Muang，Nong Bua Daeng', makerType:'社区缝纫小组',
        coreValue:'把社区纺织手艺带进日常生活',
        materialOrIngredient:'布料',
        craftProcess:'选布 → 裁剪 → 缝合 → 完成日常实用造型',
        whyHere:'体现 Nong Bua Daeng 的地方缝纫技艺与社区产品延伸。',
        shortDescription:'这只布包把社区手艺带出村庄，进入每天的使用场景。它不追求过度华丽，而是在裁剪、缝合与每一道线迹里留下制作者的认真。',
        imageCaption:'把社区手艺带出村庄的实用布包'
      },
      'chaiyaphum-otop-005': {
        name:'干燥马蜂橙除味包', originPlace:'Chatturat', makerType:'社区草本产品小组',
        coreValue:'把熟悉的本地草本变成日常用品',
        materialOrIngredient:'马蜂橙',
        craftProcess:'挑选 → 切开 → 晒干或烘干 → 包装',
        whyHere:'把当地熟悉的草本转化成简单、实用的居家用品。',
        shortDescription:'厨房里熟悉的马蜂橙经过干燥后更易保存，同时保留清新的柑橘香气，成为一种简单而贴近日常的草本用品。',
        imageCaption:'把马蜂橙的清新香气带进日常空间'
      },
      'chaiyaphum-otop-006': {
        name:'猜也蓬 Mam 发酵肉肠', originPlace:'猜也蓬', makerType:'地方食品制作者',
        coreValue:'需要时间才能完成风味的发酵食物',
        materialOrIngredient:'肉类与地方调味料',
        craftProcess:'调味 → 发酵 → 等待风味成熟',
        whyHere:'Mam 与伊森地区以发酵方式保存肉类的饮食传统紧密相连。',
        shortDescription:'猜也蓬 Mam 是一种不能催促的地方发酵食品。肉与香料需要时间慢慢融合，最终形成当地极具辨识度的味道。',
        imageCaption:'由时间塑造风味的地方发酵食品'
      },
      'chaiyaphum-otop-007': {
        name:'Pla Ra Bong / Jaew Bong 发酵鱼酱', originPlace:'猜也蓬', makerType:'地方食品制作者',
        coreValue:'可以保存的伊森厨房味道',
        materialOrIngredient:'发酵鱼与香草',
        craftProcess:'调味发酵鱼 → 拌入香草 → 制成即食蘸酱',
        whyHere:'Pla ra 与 jaew bong 深深连着伊森的食物保存方式和糯米饮食文化。',
        shortDescription:'发酵鱼与地方香草经过调味，变得香浓、鲜咸又易入口。它不只是一碟蘸酱，也是伊森厨房与糯米饭桌的熟悉记忆。',
        imageCaption:'与糯米饭相伴的伊森浓郁风味'
      },
      'chaiyaphum-otop-008': {
        name:'社区健康米', originPlace:'猜也蓬', makerType:'猜也蓬稻米加工小组',
        coreValue:'把价值重新带回稻田',
        materialOrIngredient:'大米',
        craftProcess:'选米 → 加工 → 包装成方便食用的形式',
        whyHere:'把当地农民的收成转化成更符合现代饮食方式的产品。',
        shortDescription:'当地农民种出的稻米经过挑选与加工，更适合现代日常使用。它的价值不仅是米本身，也在于让更多价值回到种植者手中。',
        imageCaption:'让本地稻米获得新的价值'
      },
      'chaiyaphum-otop-009': {
        name:'手编糯米竹篮', originPlace:'猜也蓬', makerType:'社区编织工匠',
        coreValue:'从糯米饮食文化诞生的器物',
        materialOrIngredient:'竹子或天然纤维',
        craftProcess:'劈成细条 → 编织成形 → 制作盖与底',
        whyHere:'糯米篮与伊森日常吃糯米的生活方式密不可分。',
        shortDescription:'天然材料被劈成细条，再一层层编成能保温糯米的篮子。这个朴素器物里藏着时间、手艺，也藏着家常饭桌的温度。',
        imageCaption:'盛着糯米，也盛着一顿家常饭的温度'
      },
      'chaiyaphum-otop-010': {
        name:'草本香膏 / 按摩油', originPlace:'猜也蓬', makerType:'社区草本产品制作者',
        coreValue:'把传统自我照护智慧做成方便携带的日用品',
        materialOrIngredient:'地方草本',
        craftProcess:'挑选草本 → 提取或熬煮 → 调制成香膏或按摩油',
        whyHere:'把社区熟悉的草本知识转化为现代生活中易用、易携带的产品。',
        shortDescription:'草本香膏与按摩油把社区熟悉的日常照护知识缩进小巧便携的形式，可以放在家里、车上或随身包中。',
        imageCaption:'方便随身携带的地方草本智慧'
      }
    },
    lo: {
      'chaiyaphum-otop-001': {
        name:'ຜ້າໄໝມັດໝີ່ບ້ານເຂວ້າ', originPlace:'ບ້ານເຂວ້າ', makerType:'ຊ່າງທໍຜ້າຊຸມຊົນ',
        coreValue:'ຜືນຜ້າທີ່ເກັບເວລາ ແລະ ຝີມືຂອງບ້ານເຂວ້າ',
        materialOrIngredient:'ເສັ້ນໄໝ',
        craftProcess:'ມັດລາຍ → ຍ້ອມເສັ້ນໄໝ → ທໍດ້ວຍມື',
        whyHere:'ບ້ານເຂວ້າມີຊື່ສຽງເລື່ອງຜ້າໄໝມັດໝີ່ ແລະ ວິຖີການທໍຜ້າທີ່ຍັງສືບຕໍ່.',
        shortDescription:'ຜ້າໄໝມັດໝີ່ບ້ານເຂວ້າເລີ່ມຈາກການມັດລາຍ ຍ້ອມເສັ້ນໄໝ ແລະ ທໍດ້ວຍມື. ແຕ່ລະຜືນຈຶ່ງມີຈັງຫວະຂອງຄົນທໍ ແລະ ອັດລັກຂອງບ້ານເຂວ້າ.',
        imageCaption:'ຜ້າໄໝທີ່ເລົ່າເລື່ອງບ້ານເຂວ້າຜ່ານມືຄົນທໍ'
      },
      'chaiyaphum-otop-002': {
        name:'ໝວກຜ້າໄໝຈາກເສດຜ້າ', originPlace:'ບ້ານເຂວ້າ', makerType:'ກຸ່ມງານຜ້າຊຸມຊົນ',
        coreValue:'ບໍ່ປ່ອຍໃຫ້ຄວາມງາມຂອງເສດຜ້າສູນເສຍ',
        materialOrIngredient:'ເສດຜ້າໄໝ',
        craftProcess:'ຄັດເສດຜ້າ → ຕໍ່ຜ້າ → ຫຍິບເປັນໝວກ',
        whyHere:'ຕໍ່ຍອດງານໄໝຂອງບ້ານເຂວ້າໃຫ້ເປັນຂອງໃຊ້ຮ່ວມສະໄໝ.',
        shortDescription:'ເສດຜ້າໄໝຈາກການທໍຖືກເກັບກັບມາຕໍ່ ແລະ ຫຍິບເປັນໝວກ. ແຕ່ລະໃບມີສີ ແລະ ລາຍບໍ່ຊ້ຳກັນ ເຮັດໃຫ້ເສດຜ້າໄດ້ຊີວິດໃໝ່.',
        imageCaption:'ເສດຜ້າໄໝທີ່ຖືກຕໍ່ຊີວິດເປັນຂອງໃຊ້'
      },
      'chaiyaphum-otop-003': {
        name:'ກ້ວຍກອບແກ້ວ Nok Krajib', originPlace:'ບ້ານໜອງບໍ່', makerType:'ກຸ່ມແປຮູບອາຫານຊຸມຊົນ',
        coreValue:'ຜົນຜະລິດໃກ້ບ້ານທີ່ກາຍເປັນຂອງກິນຊຸມຊົນ',
        materialOrIngredient:'ກ້ວຍ',
        craftProcess:'ຄັດກ້ວຍ → ຫັ່ນບາງ → ທອດໃຫ້ກອບ → ປຸງລົດ',
        whyHere:'ນຳວັດຖຸດິບໃກ້ບ້ານມາແປຮູບໃຫ້ເກັບໄດ້ດົນ ແລະ ເພີ່ມມູນຄ່າ.',
        shortDescription:'ກ້ວຍທ້ອງຖິ່ນຖືກແປຮູບເປັນຂອງກິນກອບ ຫວານ ແລະ ເກັບໄດ້ດົນ. ເປັນຂອງກິນງ່າຍໆ ທີ່ສະທ້ອນແຮງງານຂອງຊຸມຊົນ.',
        imageCaption:'ກ້ວຍທ້ອງຖິ່ນທີ່ກາຍເປັນຂອງກິນຊຸມຊົນ'
      },
      'chaiyaphum-otop-004': {
        name:'ກະເປົາຜ້າອະເນກປະສົງ', originPlace:'ບ້ານລາດວັງມ່ວງ ໜອງບົວແດງ', makerType:'ກຸ່ມຫຍິບຜ້າຊຸມຊົນ',
        coreValue:'ງານຜ້າຊຸມຊົນທີ່ນຳໄປໃຊ້ໄດ້ທຸກມື້',
        materialOrIngredient:'ຜ້າ',
        craftProcess:'ເລືອກຜ້າ → ຕັດຮູບ → ຫຍິບປະກອບ → ພ້ອມໃຊ້',
        whyHere:'ສະທ້ອນຝີມືການຫຍິບ ແລະ ການຕໍ່ຍອດຜະລິດຕະພັນໃນໜອງບົວແດງ.',
        shortDescription:'ກະເປົາຜ້າຈາກບ້ານລາດວັງມ່ວງນຳງານຝີມືຂອງຊຸມຊົນອອກສູ່ຊີວິດປະຈຳວັນ. ຄວາມຕັ້ງໃຈຂອງຄົນເຮັດຢູ່ໃນທຸກຮອຍຫຍິບ.',
        imageCaption:'ກະເປົາຜ້າທີ່ພາງານຝີມືຊຸມຊົນອອກນອກໝູ່ບ້ານ'
      },
      'chaiyaphum-otop-005': {
        name:'ໝາກກູດແຫ້ງດັບກິ່ນ', originPlace:'ຈັດຕຸຣັດ', makerType:'ກຸ່ມຜະລິດຕະພັນສະໝຸນໄພຊຸມຊົນ',
        coreValue:'ສະໝຸນໄພໃກ້ບ້ານທີ່ກາຍເປັນຂອງໃຊ້',
        materialOrIngredient:'ໝາກກູດ',
        craftProcess:'ຄັດ → ຜ່າ/ຫັ່ນ → ຕາກ ຫຼື ອົບແຫ້ງ → ບັນຈຸ',
        whyHere:'ຕໍ່ຍອດສະໝຸນໄພທ້ອງຖິ່ນເປັນຂອງໃຊ້ງ່າຍໆ ໃນຊີວິດປະຈຳວັນ.',
        shortDescription:'ໝາກກູດທີ່ຄຸ້ນໃນເຮືອນຄົວຖືກນຳມາເຮັດໃຫ້ແຫ້ງ ເພື່ອເກັບໄດ້ດົນ ແລະ ຍັງມີກິ່ນສົດຊື່ນ.',
        imageCaption:'ກິ່ນສົດຂອງໝາກກູດໃນຮູບແບບຂອງໃຊ້'
      },
      'chaiyaphum-otop-006': {
        name:'ໝ່ຳໄຊຍະພູມ', originPlace:'ໄຊຍະພູມ', makerType:'ກຸ່ມອາຫານທ້ອງຖິ່ນ',
        coreValue:'ອາຫານໝັກທີ່ຕ້ອງໃຊ້ເວລາ',
        materialOrIngredient:'ຊີ້ນ ແລະ ເຄື່ອງປຸງທ້ອງຖິ່ນ',
        craftProcess:'ປຸງຊີ້ນ → ໝັກ → ລໍຖ້າໃຫ້ລົດຊາດພັດທະນາ',
        whyHere:'ໝ່ຳຜູກກັບວິຖີການຖະໜອມຊີ້ນດ້ວຍການໝັກຂອງຄົນອີສານ.',
        shortDescription:'ໝ່ຳໄຊຍະພູມແມ່ນອາຫານທີ່ເລັ່ງບໍ່ໄດ້. ຊີ້ນ ແລະ ເຄື່ອງປຸງຕ້ອງໃຊ້ເວລາໃຫ້ລົດຊາດຄ່ອຍໆ ເກີດຂຶ້ນ.',
        imageCaption:'ອາຫານໝັກທີ່ລົດຊາດເກີດຈາກເວລາ'
      },
      'chaiyaphum-otop-007': {
        name:'ປາແດກບອງ / ແຈ່ວບອງ', originPlace:'ໄຊຍະພູມ', makerType:'ກຸ່ມອາຫານທ້ອງຖິ່ນ',
        coreValue:'ລົດຊາດຄົວອີສານທີ່ເກັບໄວ້ໄດ້',
        materialOrIngredient:'ປາແດກ ແລະ ສະໝຸນໄພ',
        craftProcess:'ປຸງປາແດກ → ຄົນກັບສະໝຸນໄພ → ເຮັດໃຫ້ພ້ອມກິນ',
        whyHere:'ປາແດກ ແລະ ແຈ່ວບອງຜູກກັບການຖະໜອມອາຫານ ແລະ ວິຖີກິນເຂົ້າໜຽວຂອງອີສານ.',
        shortDescription:'ປາແດກບອງປຸງກັບສະໝຸນໄພໃຫ້ຫອມ ແລະ ກິນງ່າຍ. ມັນບໍ່ແມ່ນພຽງແຕ່ນ້ຳພິກ ແຕ່ເປັນຄວາມຈື່ຈຳຂອງຄົວອີສານ.',
        imageCaption:'ລົດຊາດເຂັ້ມຂອງຄົວອີສານຄູ່ກັບເຂົ້າໜຽວ'
      },
      'chaiyaphum-otop-008': {
        name:'ເຂົ້າເພື່ອສຸຂະພາບຊຸມຊົນ', originPlace:'ໄຊຍະພູມ', makerType:'ກຸ່ມແປຮູບເຂົ້າໄຊຍະພູມ',
        coreValue:'ເພີ່ມມູນຄ່າກັບຄືນສູ່ທົ່ງນາ',
        materialOrIngredient:'ເຂົ້າ',
        craftProcess:'ຄັດເຂົ້າ → ແປຮູບ → ບັນຈຸໃຫ້ໃຊ້ງ່າຍ',
        whyHere:'ນຳຜົນຜະລິດຂອງຊາວນາທ້ອງຖິ່ນມາຕໍ່ຍອດໃຫ້ເໝາະກັບການກິນຍຸກໃໝ່.',
        shortDescription:'ເຂົ້າຈາກຊາວນາໃນພື້ນທີ່ຖືກຄັດ ແລະ ແປຮູບໃຫ້ໃຊ້ງ່າຍຂຶ້ນ. ຄຸນຄ່າບໍ່ໄດ້ຢູ່ທີ່ເຂົ້າຢ່າງດຽວ ແຕ່ຢູ່ທີ່ມູນຄ່າທີ່ກັບຄືນຫາຄົນປູກ.',
        imageCaption:'ເຂົ້າຈາກທົ່ງນາທີ່ຖືກເພີ່ມຄຸນຄ່າ'
      },
      'chaiyaphum-otop-009': {
        name:'ກະຕິບເຂົ້າໜຽວສານດ້ວຍມື', originPlace:'ໄຊຍະພູມ', makerType:'ຊ່າງສານຊຸມຊົນ',
        coreValue:'ພາຊະນະທີ່ເກີດຈາກວິຖີກິນເຂົ້າໜຽວ',
        materialOrIngredient:'ໄມ້ໄຜ່ ຫຼື ວັດສະດຸທຳມະຊາດ',
        craftProcess:'ຈັກວັດສະດຸ → ສານຂຶ້ນຮູບ → ເຮັດຝາ ແລະ ຖານ',
        whyHere:'ກະຕິບເຂົ້າໜຽວຜູກກັບວິຖີກິນເຂົ້າໜຽວຂອງຄົນອີສານ.',
        shortDescription:'ວັດສະດຸທຳມະຊາດຖືກຈັກເປັນເສັ້ນ ແລະ ສານຂຶ້ນຮູບທີລະຊັ້ນ. ຂອງໃຊ້ງ່າຍໆ ຊິ້ນນີ້ເກັບທັງເວລາ ຝີມື ແລະ ຄວາມອົບອຸ່ນຂອງມື້ອາຫານ.',
        imageCaption:'ພາຊະນະງ່າຍໆ ທີ່ເກັບຄວາມອົບອຸ່ນຂອງເຂົ້າໜຽວ'
      },
      'chaiyaphum-otop-010': {
        name:'ຢາຫອມ / ນ້ຳມັນນວດສະໝຸນໄພ', originPlace:'ໄຊຍະພູມ', makerType:'ຜູ້ເຮັດຜະລິດຕະພັນສະໝຸນໄພຊຸມຊົນ',
        coreValue:'ພູມປັນຍາດູແລຕົນເອງໃນຮູບແບບພົກພາ',
        materialOrIngredient:'ສະໝຸນໄພທ້ອງຖິ່ນ',
        craftProcess:'ຄັດສະໝຸນໄພ → ສະກັດ ຫຼື ຕົ້ມ → ຜະສົມເປັນຢາ ຫຼື ນ້ຳມັນ',
        whyHere:'ຕໍ່ຍອດຄວາມຮູ້ສະໝຸນໄພທ້ອງຖິ່ນເປັນຂອງໃຊ້ພົກພາງ່າຍ.',
        shortDescription:'ຢາຫອມ ແລະ ນ້ຳມັນນວດສະໝຸນໄພນຳພູມປັນຍາການດູແລຕົນເອງຂອງຊຸມຊົນມາຢູ່ໃນຮູບແບບນ້ອຍ ແລະ ພົກພາງ່າຍ.',
        imageCaption:'ພູມປັນຍາສະໝຸນໄພທ້ອງຖິ່ນໃນຮູບແບບພົກພາ'
      }
    },
    vi: {
      'chaiyaphum-otop-001': {
        name:'Lụa Mudmee Ban Khwao', originPlace:'Ban Khwao', makerType:'Thợ dệt lụa cộng đồng',
        coreValue:'Một tấm vải lưu giữ thời gian và tay nghề của Ban Khwao',
        materialOrIngredient:'Sợi tơ',
        craftProcess:'Buộc tạo hoa văn → nhuộm sợi → dệt thủ công trên khung',
        whyHere:'Ban Khwao nổi tiếng với lụa Mudmee và truyền thống dệt địa phương vẫn đang được gìn giữ.',
        shortDescription:'Lụa Mudmee Ban Khwao bắt đầu từ việc buộc hoa văn, nhuộm sợi rồi dệt thủ công. Mỗi tấm vải mang nhịp tay của người dệt và bản sắc riêng của Ban Khwao.',
        imageCaption:'Tấm lụa kể câu chuyện Ban Khwao qua đôi tay người dệt'
      },
      'chaiyaphum-otop-002': {
        name:'Mũ ghép từ vải lụa tái sử dụng', originPlace:'Ban Khwao', makerType:'Nhóm dệt may cộng đồng',
        coreValue:'Không để vẻ đẹp của những mảnh lụa bị bỏ phí',
        materialOrIngredient:'Vải lụa thừa',
        craftProcess:'Chọn vải thừa → ghép vải → may thành mũ',
        whyHere:'Tiếp nối nghề lụa Ban Khwao thành một vật dụng đương đại và thực tế.',
        shortDescription:'Những mảnh lụa còn lại sau quá trình dệt được gom lại, ghép và may thành mũ. Mỗi chiếc có màu và hoa văn khác nhau, tạo cho phần vải còn lại một đời sống mới.',
        imageCaption:'Những mảnh lụa được hồi sinh thành vật dụng hằng ngày'
      },
      'chaiyaphum-otop-003': {
        name:'Chuối giòn Nok Krajib', originPlace:'Ban Nong Bo', makerType:'Nhóm chế biến thực phẩm cộng đồng',
        coreValue:'Nông sản quanh nhà trở thành món ăn của cộng đồng',
        materialOrIngredient:'Chuối',
        craftProcess:'Chọn chuối → thái mỏng → chiên giòn → phủ vị',
        whyHere:'Tận dụng nguyên liệu địa phương, kéo dài thời gian bảo quản và tăng giá trị nông sản.',
        shortDescription:'Chuối địa phương được chế biến thành món ăn giòn, ngọt nhẹ và bảo quản được lâu hơn. Một món đơn giản nhưng kể được câu chuyện lao động và cách cộng đồng tăng giá trị cho nông sản.',
        imageCaption:'Chuối địa phương trở thành món ăn do cộng đồng làm ra'
      },
      'chaiyaphum-otop-004': {
        name:'Túi vải đa dụng cộng đồng', originPlace:'Ban Lat Wang Muang, Nong Bua Daeng', makerType:'Nhóm may cộng đồng',
        coreValue:'Nghề vải cộng đồng bước vào đời sống hằng ngày',
        materialOrIngredient:'Vải',
        craftProcess:'Chọn vải → cắt dáng → may ráp → hoàn thiện để sử dụng',
        whyHere:'Phản ánh tay nghề may và cách cộng đồng Nong Bua Daeng phát triển sản phẩm địa phương.',
        shortDescription:'Chiếc túi đưa tay nghề của Ban Lat Wang Muang vào đời sống thường ngày. Không cần quá cầu kỳ, sự chăm chút của người làm hiện rõ trong từng đường may.',
        imageCaption:'Chiếc túi đưa nghề thủ công cộng đồng ra ngoài làng'
      },
      'chaiyaphum-otop-005': {
        name:'Chanh makrut sấy khô khử mùi', originPlace:'Chatturat', makerType:'Nhóm sản phẩm thảo mộc cộng đồng',
        coreValue:'Một loại thảo mộc quen thuộc trở thành vật dụng hằng ngày',
        materialOrIngredient:'Chanh makrut',
        craftProcess:'Chọn quả → cắt → phơi hoặc sấy → đóng gói',
        whyHere:'Biến loại thảo mộc quen thuộc thành một sản phẩm gia dụng đơn giản và hữu ích.',
        shortDescription:'Chanh makrut quen thuộc trong bếp được làm khô để bảo quản lâu hơn nhưng vẫn giữ hương cam chanh tươi mát, trở thành một vật dụng thảo mộc gần gũi.',
        imageCaption:'Hương makrut tươi mát trong một vật dụng giản dị'
      },
      'chaiyaphum-otop-006': {
        name:'Mam lên men Chaiyaphum', originPlace:'Chaiyaphum', makerType:'Nhóm làm thực phẩm địa phương',
        coreValue:'Món lên men cần thời gian để tạo nên hương vị',
        materialOrIngredient:'Thịt và gia vị địa phương',
        craftProcess:'Nêm thịt → lên men → chờ hương vị phát triển',
        whyHere:'Mam gắn chặt với truyền thống bảo quản thịt bằng lên men của người Isan.',
        shortDescription:'Mam Chaiyaphum là món ăn không thể vội. Thịt và gia vị cần thời gian để hương vị phát triển từ từ, tạo nên một trong những nét vị dễ nhận ra của địa phương.',
        imageCaption:'Món ăn lên men có hương vị được tạo nên bởi thời gian'
      },
      'chaiyaphum-otop-007': {
        name:'Pla Ra Bong / Jaew Bong', originPlace:'Chaiyaphum', makerType:'Nhóm làm thực phẩm địa phương',
        coreValue:'Hương vị bếp Isan có thể giữ được lâu',
        materialOrIngredient:'Cá lên men và thảo mộc',
        craftProcess:'Nêm cá lên men → trộn thảo mộc → chế biến sẵn để ăn',
        whyHere:'Pla ra và jaew bong gắn với cách bảo quản thực phẩm và văn hóa ăn xôi của Isan.',
        shortDescription:'Cá lên men được nêm cùng thảo mộc địa phương cho thơm, đậm và dễ ăn hơn. Không chỉ là món chấm, đây còn là ký ức quen thuộc của căn bếp Isan và những bữa xôi.',
        imageCaption:'Vị đậm của bếp Isan bên cạnh xôi'
      },
      'chaiyaphum-otop-008': {
        name:'Gạo cộng đồng hướng đến sức khỏe', originPlace:'Chaiyaphum', makerType:'Nhóm chế biến gạo Chaiyaphum',
        coreValue:'Đưa giá trị trở lại cánh đồng',
        materialOrIngredient:'Gạo',
        craftProcess:'Chọn gạo → chế biến → đóng gói tiện sử dụng',
        whyHere:'Phát triển nông sản của người trồng địa phương thành sản phẩm phù hợp với cách ăn hiện đại.',
        shortDescription:'Gạo từ nông dân địa phương được tuyển chọn và chế biến để tiện dùng hơn trong cuộc sống hiện đại. Giá trị không chỉ nằm ở hạt gạo mà còn ở phần giá trị quay trở lại người trồng.',
        imageCaption:'Hạt gạo từ cánh đồng được tạo thêm giá trị'
      },
      'chaiyaphum-otop-009': {
        name:'Giỏ tre đựng xôi đan tay', originPlace:'Chaiyaphum', makerType:'Thợ đan cộng đồng',
        coreValue:'Một vật dụng sinh ra từ văn hóa ăn xôi',
        materialOrIngredient:'Tre hoặc vật liệu tự nhiên',
        craftProcess:'Chẻ vật liệu → đan tạo dáng → làm nắp và đáy',
        whyHere:'Giỏ đựng xôi gắn trực tiếp với nếp ăn xôi trong đời sống Isan.',
        shortDescription:'Vật liệu tự nhiên được chẻ thành nan rồi đan từng lớp thành chiếc giỏ giữ xôi ấm. Vật dụng giản dị này chứa cả thời gian, tay nghề và hơi ấm của bữa cơm nhà.',
        imageCaption:'Một vật dụng giản dị giữ cả xôi và hơi ấm của bữa ăn'
      },
      'chaiyaphum-otop-010': {
        name:'Cao thảo mộc / Dầu massage', originPlace:'Chaiyaphum', makerType:'Nhóm làm sản phẩm thảo mộc cộng đồng',
        coreValue:'Kiến thức chăm sóc bản thân truyền thống trong dạng thức dễ mang theo',
        materialOrIngredient:'Thảo mộc địa phương',
        craftProcess:'Chọn thảo mộc → chiết hoặc nấu → pha thành cao hoặc dầu',
        whyHere:'Biến kiến thức thảo mộc quen thuộc của cộng đồng thành sản phẩm nhỏ gọn cho đời sống hằng ngày.',
        shortDescription:'Cao và dầu massage thảo mộc đưa kiến thức chăm sóc bản thân quen thuộc của cộng đồng vào dạng nhỏ gọn, có thể để ở nhà, trong xe hoặc mang theo trong túi.',
        imageCaption:'Kiến thức thảo mộc địa phương trong một dạng thức dễ mang theo'
      }
    }
  };

  function get(id, lang, fallback={}) {
    if (!lang || lang === 'th') return fallback;
    const row = T[lang]?.[id];
    return row ? { ...fallback, ...row } : fallback;
  }

  window.OTOP_PRODUCT_TRANSLATIONS = { get };
})();
