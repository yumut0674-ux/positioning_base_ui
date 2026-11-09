import {readFile} from 'node:fs/promises';
import {importTest,datasetDir} from '../importer';
for(const id of ['test-344ab34d-5988-4308-be11-99eb88a54bd4','test-9a7debf0-57ad-4df2-802b-ae92e4c20b13']){
  const audit=JSON.parse(await readFile('tools/room-benchmark/reports/servis-pdop-two-20261013/'+id+'-audit.json','utf8'));
  const source=JSON.parse(await readFile(datasetDir(id)+'/source.json','utf8'));
  if(!(source.tag_id in audit.candidates))throw Error('Açık tag aralıkta yok; başka tag atanmaz');
  console.log(JSON.stringify({testId:id,candidates:audit.candidates}));
  console.log(JSON.stringify(await importTest(id,source.tag_codes),null,2));
}
