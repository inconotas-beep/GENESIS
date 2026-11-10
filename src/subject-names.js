/* Explicit academic aliases. Never fuzzy-merge distinct subjects or module codes. */
var SubjectNames=(()=>{
 const key=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[.\s]+$/g,'').replace(/\s+/g,' ').trim();
 const groups=[
 ['Precálculo',['mate','mat','mat.','matematica','matematicas','precalculo','pre calculo','precálculo']],
 ['Lenguaje y Literatura',['lengua','lenguaje','lengua y literatura','lengua y literaura','lenguaje y literatura']],
 ['Ciudadanía y Valores',['ciudadania','ciudadanía y valores','cuidadanía y valores']],
 ['Ciencia y Tecnología',['ciencia y técnología','ciencias y tecnologia']],
 ['Emprendedurismo',['emprendedurismo','emprededurismo','1.7 Emprededurismo','2.7 Emprededurismo','2.7Emprededurismo']],
 ['Proyecto de Vida y Carrera',['proyecto de vida','proyecto de vida y carrera']],
 ['Física',['fisica']],['Informática',['informatica']],['Inglés',['ingles']],['Inglés Técnico',['ingles tecnico']],
 ['Finanzas y Economía',['finanzas y economia']],['Ciencias Naturales',['ciencias naturales']],['Ciencias de la Computación',['ciencias de la computacion']],
 ['Costos',['costos']],['Estudios Sociales',['estudios sociales']],['Orientación para la Vida',['orientacion para la vida']],['Competencias',['compentencias','competencias']],
 ['1.1 Caracterización del sistema turístico de El Salvador',[]],
 ['1.1 Elaboración de algoritmos usando lógica de programación',[]],['1.1 Manejo de información y registro contable',[]],
 ['1.1 Orientación de estudiantes al proceso educativo del primer año de estudio',['1.1 ORIENTACIÓN DE ESTUDIANTES AL PROCESO EDUCATIVO DEL PRIMER AÑO DE ESTUDIO 1']],
 ['1.2 Identificación de requerimientos para diseñar o modificar sistemas informáticos',[]],['1.2 Manejo, redacción y archivo de documentación en la empresa',[]],
 ['1.2 Promoción turística del patrimonio natural e histórico cultural',[]],
 ['1.2 Promoción turística del patrimonio nacional e historia cultural',['1.2 Promoció turística del patrimonio nacional e historia cultural']],
 ['1.3 Diseño de aplicaciones multimedia',[]],['1.4 Atención al turismo accesible, sostenible y social',[]],['1.4 Elaboración de manual de sistemas de calidad para el desarrollo de software',[]],['1.4 Mantenimiento y uso eficiente de recursos técnicos y tecnológicos',[]],
 ['1.5 Aplicación de herramientas tecnológicas en el sector turístico',[]],['1.5 Desarrollo de páginas web',['1.5 DESARROLLO DE PÁGINA WEB']],['1.5 Gestión de procesos y control interno de empresa',[]],
 ['1.6 Prestación de servicios de hotelería',['1.6 PRESENTACIÓN DE SERVICIOSDE HOTELERIA']],['1.7 Emprendedurismo colaborativo',[]],['1.7 Ideas emprendedoras colaborativas turísticas',[]],
 ['1.8 Proyecto tecnológico de desarrollo de páginas web',[]],['1.8 Proyecto tecnológico para la organización administrativa de las MIPYME',[]],
 ['2.1 Cálculo de costos y presupuestos operativos de la empresa',[]],['2.1 Diseño de sistemas informáticos',[]],['2.1 Organización de los establecimientos de alimentos y bebidas',[]],
 ['2.2 Preparación de alimentos y comida',[]],['2.2 Diseño de arquitectura de software',[]],['2.2 Elaboración y análisis de estados financieros',[]],
 ['2.2 Preparación de productos típicos de la gastronomía salvadoreña',['2.2 Preparación de productos de la gastronomia salvadoreña']],
 ['2.3 Preparación de productos típicos de la gastronomía salvadoreña',['2.3 Preparación de productos típicos de productos típicos de la gastronomía salvadoreña']],
 ['2.3 Aplicación de la legislación tributaria a las operaciones empresariales',[]],['2.3 Preparación de alimentos y bebidas',[]],['2.3 Programación de componentes de bases de datos',['2.3 Programación de componentes de Base de Datos']],
 ['2.4 Desarrollo del montaje de eventos y banquetes',['2.4 Desarrolla el montaje de eventos y banquetes']],['2.4 Desarrollo de programación orientada a objetos',[]],['2.4 Gestión de compras en empresa privada y pública',[]],
 ['2.5 Diseño e instalación de redes LAN',[]],['2.5 Elaboración de productos de panadería y pastelería',['2.5 Elaboración de productos de panadería']],['2.5 Gestión de información y atención al cliente',[]],
 ['2.7 Diseño de planes de negocios turísticos',['2.7 Diseño de plan de negocios turísticos']],['2.7 Diseño de planes de negocio en asociatividad cooperativa',['2.7 Diseño de planes de negocio en Asociatidad Cooperativa']],
 ['2.8 Proyecto innovador de desarrollo de portales web',[]],['2.8 Proyecto tecnológico sobre nuevas herramientas informáticas para el manejo de las operaciones empresariales',[]],
 ['3.1 Registro de transacciones de estados financieros para los sectores de la banca, seguros, agrícola y gobierno',[]],['3.1 Desarrollo de aplicaciones de software para la solución de problemas',[]],['3.1 Diseño y ejecución de paquetes turísticos',[]],
 ['3.2 Aplicación de legislación mercantil, laboral y aduanera a las operaciones empresariales',['3.2 APLICACIÓN DE LEGISLACIÓN MERCANTIL LABORAL Y ADUANERA A LAS OPERACIONES EMPRESARIALES']],
 ['3.2 Manejo de software y redes sociales aplicativas en la gestión de empresas turísticas',[]],['3.2 Mantenimiento y aseguramiento de la operación del sistema informático',[]],
 ['3.3 Administración de bases de datos',['3.3 ADMINISTRACIÓN DE BASE DE DATOS']],['3.3 Promoción y comercialización de productos turísticos',[]],['3.3 Técnicas para la administración del recurso humano',[]],
 ['3.4 Elaboración de documentación de sistemas informáticos',[]],['3.4 Evaluación de servicios turísticos',[]],['3.4 Formulación de proyectos de comercialización internacional',[]],
 ['3.5 Cálculos financieros aplicados a los negocios',[]],['3.5 Desarrollo de componentes para dispositivos móviles',['3.5 DESARROLLO DE COMPONENTES PARA DIPOSITIVOS MÓVILES']],
 ['3.6 Conversación en inglés sobre mantenimiento de sistemas informáticos',[]],['3.6 Conversación en inglés: administración y servicios turísticos',['3.6 CONVERSACIÓN EN INGLÉS ADMINISTRACIÓN Y SERVICIOSTURÍSTICOS']],
 ['3.6 Inglés técnico',[]],['3.6 Interpretación de información en inglés sobre mercadeo y comercialización',['3.6 INTERPRETACIÓN DE INFORMACIÓN EN INGLÉS SOBRE NERCADEO Y COMERCIALIZACIÓN']],
 ['3.7 Puesta en marcha de la microempresa en asociatividad cooperativa',[]],['3.8 Elaboración de proyecto emprendedor para la autoempleabilidad',[]],
 ['3.8 Proyecto de desarrollo de un plan de mercadeo para MIPE de servicios turísticos',['3.8 PROYECTO DE DESARROLLO DE UN PLAN DE MERCADEO PARA MIPE SERVICIOS Y/O SERVICIOS TURISTICOS']],
 ['3.8 Proyecto de desarrollo de un plan de mercadeo para MYPE de servicios y destinos turísticos',['3.8 PROYECTO DE DESARROLLO DE UN PLAN DE MERCADEO PARA MYPE SERVICIO Y/O DESTINOS TURISTICOS']],
 ['3.8 Proyecto innovador de desarrollo de software',[]]
 ];
 const aliases=new Map();for(const [canonical,variants]of groups)for(const name of [canonical,...variants])aliases.set(key(name),canonical);
 return {key,canonical:name=>aliases.get(key(name))||String(name).trim().replace(/\s+/g,' ')};
})();
