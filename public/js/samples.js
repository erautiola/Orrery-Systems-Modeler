/* ============================================================================
 * samples.js — Embedded XMI samples so the tool is usable with no file on hand.
 * Both are valid OMG XMI 2.x; the SysML one applies «block»/«requirement»
 * stereotypes via profile-application elements (base_Class references).
 * ==========================================================================*/
(function (global) {
  "use strict";

  const UML = `<?xml version="1.0" encoding="UTF-8"?>
<xmi:XMI xmi:version="2.1"
  xmlns:xmi="http://schema.omg.org/spec/XMI/2.1"
  xmlns:uml="http://schema.omg.org/spec/UML/2.1">
 <uml:Model xmi:type="uml:Model" name="LibrarySystem">
  <packagedElement xmi:type="uml:Package" name="domain" xmi:id="pkg_domain">

   <packagedElement xmi:type="uml:PrimitiveType" name="String" xmi:id="t_string"/>
   <packagedElement xmi:type="uml:PrimitiveType" name="Integer" xmi:id="t_int"/>
   <packagedElement xmi:type="uml:PrimitiveType" name="Date" xmi:id="t_date"/>
   <packagedElement xmi:type="uml:PrimitiveType" name="Boolean" xmi:id="t_bool"/>

   <packagedElement xmi:type="uml:Enumeration" name="ItemStatus" xmi:id="e_status">
     <ownedLiteral xmi:type="uml:EnumerationLiteral" name="Available" xmi:id="l1"/>
     <ownedLiteral xmi:type="uml:EnumerationLiteral" name="OnLoan" xmi:id="l2"/>
     <ownedLiteral xmi:type="uml:EnumerationLiteral" name="Reserved" xmi:id="l3"/>
     <ownedLiteral xmi:type="uml:EnumerationLiteral" name="Lost" xmi:id="l4"/>
   </packagedElement>

   <packagedElement xmi:type="uml:Interface" name="Searchable" xmi:id="i_search">
     <ownedOperation xmi:type="uml:Operation" name="matches" xmi:id="io1" visibility="public">
       <ownedParameter name="query" type="t_string" direction="in"/>
       <ownedParameter name="result" type="t_bool" direction="return"/>
     </ownedOperation>
   </packagedElement>

   <packagedElement xmi:type="uml:Class" name="LibraryItem" xmi:id="c_item" isAbstract="true">
     <ownedAttribute xmi:type="uml:Property" name="title" xmi:id="a_title" type="t_string" visibility="protected"/>
     <ownedAttribute xmi:type="uml:Property" name="catalogId" xmi:id="a_cid" type="t_string" visibility="protected"/>
     <ownedAttribute xmi:type="uml:Property" name="status" xmi:id="a_status" type="e_status" visibility="protected"/>
     <ownedOperation xmi:type="uml:Operation" name="checkOut" xmi:id="op_co" visibility="public" isAbstract="true"/>
     <ownedOperation xmi:type="uml:Operation" name="checkIn" xmi:id="op_ci" visibility="public"/>
   </packagedElement>

   <packagedElement xmi:type="uml:Class" name="Book" xmi:id="c_book">
     <generalization xmi:type="uml:Generalization" xmi:id="g_book" general="c_item"/>
     <interfaceRealization xmi:type="uml:InterfaceRealization" xmi:id="r_book" contract="i_search"/>
     <ownedAttribute xmi:type="uml:Property" name="isbn" xmi:id="bk1" type="t_string"/>
     <ownedAttribute xmi:type="uml:Property" name="author" xmi:id="bk2" type="t_string"/>
     <ownedAttribute xmi:type="uml:Property" name="pages" xmi:id="bk3" type="t_int"/>
     <ownedOperation xmi:type="uml:Operation" name="checkOut" xmi:id="bk_op"/>
   </packagedElement>

   <packagedElement xmi:type="uml:Class" name="DVD" xmi:id="c_dvd">
     <generalization xmi:type="uml:Generalization" xmi:id="g_dvd" general="c_item"/>
     <ownedAttribute xmi:type="uml:Property" name="runtimeMinutes" xmi:id="dv1" type="t_int"/>
     <ownedAttribute xmi:type="uml:Property" name="region" xmi:id="dv2" type="t_int"/>
   </packagedElement>

   <packagedElement xmi:type="uml:Class" name="Member" xmi:id="c_member">
     <ownedAttribute xmi:type="uml:Property" name="name" xmi:id="m1" type="t_string"/>
     <ownedAttribute xmi:type="uml:Property" name="memberId" xmi:id="m2" type="t_string"/>
     <ownedAttribute xmi:type="uml:Property" name="joined" xmi:id="m3" type="t_date"/>
     <ownedOperation xmi:type="uml:Operation" name="borrow" xmi:id="m_op"/>
   </packagedElement>

   <packagedElement xmi:type="uml:Class" name="Loan" xmi:id="c_loan">
     <ownedAttribute xmi:type="uml:Property" name="loanDate" xmi:id="ln1" type="t_date"/>
     <ownedAttribute xmi:type="uml:Property" name="dueDate" xmi:id="ln2" type="t_date"/>
     <ownedAttribute xmi:type="uml:Property" name="returned" xmi:id="ln3" type="t_bool"/>
   </packagedElement>

   <packagedElement xmi:type="uml:Class" name="Catalog" xmi:id="c_catalog">
     <ownedAttribute xmi:type="uml:Property" name="name" xmi:id="ct1" type="t_string"/>
     <ownedOperation xmi:type="uml:Operation" name="search" xmi:id="ct_op">
       <ownedParameter name="query" type="t_string" direction="in"/>
     </ownedOperation>
   </packagedElement>

   <packagedElement xmi:type="uml:Class" name="Library" xmi:id="c_library">
     <ownedAttribute xmi:type="uml:Property" name="name" xmi:id="lb1" type="t_string"/>
     <ownedAttribute xmi:type="uml:Property" name="address" xmi:id="lb2" type="t_string"/>
   </packagedElement>

   <!-- composition: Library *owns* Catalog -->
   <packagedElement xmi:type="uml:Association" xmi:id="as_lib_cat">
     <ownedEnd xmi:type="uml:Property" name="library" xmi:id="ae1" type="c_library" association="as_lib_cat">
       <lowerValue xmi:type="uml:LiteralInteger" value="1"/>
       <upperValue xmi:type="uml:LiteralUnlimitedNatural" value="1"/>
     </ownedEnd>
     <ownedEnd xmi:type="uml:Property" name="catalog" xmi:id="ae2" type="c_catalog" association="as_lib_cat" aggregation="composite">
       <lowerValue xmi:type="uml:LiteralInteger" value="1"/>
       <upperValue xmi:type="uml:LiteralUnlimitedNatural" value="1"/>
     </ownedEnd>
   </packagedElement>

   <!-- aggregation: Catalog groups LibraryItems -->
   <packagedElement xmi:type="uml:Association" xmi:id="as_cat_item">
     <ownedEnd xmi:type="uml:Property" name="catalog" xmi:id="ae3" type="c_catalog" association="as_cat_item"/>
     <ownedEnd xmi:type="uml:Property" name="items" xmi:id="ae4" type="c_item" association="as_cat_item" aggregation="shared">
       <lowerValue xmi:type="uml:LiteralInteger" value="0"/>
       <upperValue xmi:type="uml:LiteralUnlimitedNatural" value="*"/>
     </ownedEnd>
   </packagedElement>

   <!-- association: Member has Loans -->
   <packagedElement xmi:type="uml:Association" xmi:id="as_mem_loan">
     <ownedEnd xmi:type="uml:Property" name="member" xmi:id="ae5" type="c_member" association="as_mem_loan">
       <lowerValue xmi:type="uml:LiteralInteger" value="1"/>
       <upperValue xmi:type="uml:LiteralUnlimitedNatural" value="1"/>
     </ownedEnd>
     <ownedEnd xmi:type="uml:Property" name="loans" xmi:id="ae6" type="c_loan" association="as_mem_loan">
       <lowerValue xmi:type="uml:LiteralInteger" value="0"/>
       <upperValue xmi:type="uml:LiteralUnlimitedNatural" value="*"/>
     </ownedEnd>
   </packagedElement>

   <!-- association: Loan references a LibraryItem -->
   <packagedElement xmi:type="uml:Association" xmi:id="as_loan_item">
     <ownedEnd xmi:type="uml:Property" name="loan" xmi:id="ae7" type="c_loan" association="as_loan_item"/>
     <ownedEnd xmi:type="uml:Property" name="item" xmi:id="ae8" type="c_item" association="as_loan_item">
       <lowerValue xmi:type="uml:LiteralInteger" value="1"/>
       <upperValue xmi:type="uml:LiteralUnlimitedNatural" value="1"/>
     </ownedEnd>
   </packagedElement>

  </packagedElement>
 </uml:Model>
</xmi:XMI>`;

  const SYSML = `<?xml version="1.0" encoding="UTF-8"?>
<xmi:XMI xmi:version="2.1"
  xmlns:xmi="http://schema.omg.org/spec/XMI/2.1"
  xmlns:uml="http://schema.omg.org/spec/UML/2.1"
  xmlns:sysml="http://www.omg.org/spec/SysML/20120322/SysML">
 <uml:Model xmi:type="uml:Model" name="SatelliteSystem">
  <packagedElement xmi:type="uml:Package" name="structure" xmi:id="pkg_struct">

   <packagedElement xmi:type="uml:PrimitiveType" name="Real" xmi:id="t_real"/>
   <packagedElement xmi:type="uml:PrimitiveType" name="Integer" xmi:id="t_int"/>
   <packagedElement xmi:type="uml:PrimitiveType" name="String" xmi:id="t_str"/>

   <packagedElement xmi:type="uml:Class" name="Subsystem" xmi:id="b_sub" isAbstract="true">
     <ownedAttribute xmi:type="uml:Property" name="mass" xmi:id="sa1" type="t_real"/>
     <ownedAttribute xmi:type="uml:Property" name="powerDraw" xmi:id="sa2" type="t_real"/>
     <ownedOperation xmi:type="uml:Operation" name="selfTest" xmi:id="so1"/>
   </packagedElement>

   <packagedElement xmi:type="uml:Class" name="Satellite" xmi:id="b_sat">
     <ownedAttribute xmi:type="uml:Property" name="totalMass" xmi:id="va1" type="t_real"/>
     <ownedAttribute xmi:type="uml:Property" name="orbitAltitudeKm" xmi:id="va2" type="t_real"/>
     <ownedOperation xmi:type="uml:Operation" name="deploy" xmi:id="sat_op"/>
   </packagedElement>

   <packagedElement xmi:type="uml:Class" name="PowerSubsystem" xmi:id="b_power">
     <generalization xmi:type="uml:Generalization" xmi:id="pg1" general="b_sub"/>
     <ownedAttribute xmi:type="uml:Property" name="batteryWh" xmi:id="pa1" type="t_real"/>
     <ownedAttribute xmi:type="uml:Property" name="solarAreaM2" xmi:id="pa2" type="t_real"/>
   </packagedElement>

   <packagedElement xmi:type="uml:Class" name="CommSubsystem" xmi:id="b_comm">
     <generalization xmi:type="uml:Generalization" xmi:id="cg1" general="b_sub"/>
     <ownedAttribute xmi:type="uml:Property" name="bandGHz" xmi:id="ca1" type="t_real"/>
     <ownedAttribute xmi:type="uml:Property" name="dataRateMbps" xmi:id="ca2" type="t_real"/>
   </packagedElement>

   <packagedElement xmi:type="uml:Class" name="AttitudeControl" xmi:id="b_adcs">
     <generalization xmi:type="uml:Generalization" xmi:id="ag1" general="b_sub"/>
     <ownedAttribute xmi:type="uml:Property" name="reactionWheels" xmi:id="aa1" type="t_int"/>
   </packagedElement>

   <packagedElement xmi:type="uml:Class" name="Payload" xmi:id="b_payload">
     <generalization xmi:type="uml:Generalization" xmi:id="plg1" general="b_sub"/>
     <ownedAttribute xmi:type="uml:Property" name="instrument" xmi:id="pla1" type="t_str"/>
     <ownedAttribute xmi:type="uml:Property" name="resolutionM" xmi:id="pla2" type="t_real"/>
   </packagedElement>

   <!-- Satellite composed of subsystems -->
   <packagedElement xmi:type="uml:Association" xmi:id="as_sat_power">
     <ownedEnd xmi:type="uml:Property" name="satellite" xmi:id="se1" type="b_sat" association="as_sat_power"/>
     <ownedEnd xmi:type="uml:Property" name="power" xmi:id="se2" type="b_power" association="as_sat_power" aggregation="composite">
       <lowerValue xmi:type="uml:LiteralInteger" value="1"/><upperValue xmi:type="uml:LiteralUnlimitedNatural" value="1"/>
     </ownedEnd>
   </packagedElement>
   <packagedElement xmi:type="uml:Association" xmi:id="as_sat_comm">
     <ownedEnd xmi:type="uml:Property" name="satellite" xmi:id="se3" type="b_sat" association="as_sat_comm"/>
     <ownedEnd xmi:type="uml:Property" name="comm" xmi:id="se4" type="b_comm" association="as_sat_comm" aggregation="composite">
       <lowerValue xmi:type="uml:LiteralInteger" value="1"/><upperValue xmi:type="uml:LiteralUnlimitedNatural" value="1"/>
     </ownedEnd>
   </packagedElement>
   <packagedElement xmi:type="uml:Association" xmi:id="as_sat_adcs">
     <ownedEnd xmi:type="uml:Property" name="satellite" xmi:id="se5" type="b_sat" association="as_sat_adcs"/>
     <ownedEnd xmi:type="uml:Property" name="adcs" xmi:id="se6" type="b_adcs" association="as_sat_adcs" aggregation="composite">
       <lowerValue xmi:type="uml:LiteralInteger" value="1"/><upperValue xmi:type="uml:LiteralUnlimitedNatural" value="1"/>
     </ownedEnd>
   </packagedElement>
   <packagedElement xmi:type="uml:Association" xmi:id="as_sat_payload">
     <ownedEnd xmi:type="uml:Property" name="satellite" xmi:id="se7" type="b_sat" association="as_sat_payload"/>
     <ownedEnd xmi:type="uml:Property" name="payload" xmi:id="se8" type="b_payload" association="as_sat_payload" aggregation="composite">
       <lowerValue xmi:type="uml:LiteralInteger" value="1"/><upperValue xmi:type="uml:LiteralUnlimitedNatural" value="2"/>
     </ownedEnd>
   </packagedElement>
  </packagedElement>

  <packagedElement xmi:type="uml:Package" name="requirements" xmi:id="pkg_req">
   <packagedElement xmi:type="uml:Class" name="MassBudget" xmi:id="rq_mass"/>
   <packagedElement xmi:type="uml:Class" name="PowerBudget" xmi:id="rq_power"/>
   <packagedElement xmi:type="uml:Class" name="LinkBudget"  xmi:id="rq_link"/>
  </packagedElement>

  <!-- SysML profile applications (stereotypes) -->
  <sysml:Block base_Class="b_sat"/>
  <sysml:Block base_Class="b_sub"/>
  <sysml:Block base_Class="b_power"/>
  <sysml:Block base_Class="b_comm"/>
  <sysml:Block base_Class="b_adcs"/>
  <sysml:Block base_Class="b_payload"/>
  <sysml:Requirement base_Class="rq_mass" id="R-1" text="Total dry mass shall not exceed 500 kg."/>
  <sysml:Requirement base_Class="rq_power" id="R-2" text="Bus shall supply >= 1200 W at end of life."/>
  <sysml:Requirement base_Class="rq_link" id="R-3" text="Downlink shall achieve >= 150 Mbps."/>
 </uml:Model>
</xmi:XMI>`;

  global.Samples = { UML, SYSML };
})(window);
